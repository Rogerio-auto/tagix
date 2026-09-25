/**
 * Orquestracao Graph do connect WhatsApp (Embedded Signup / Tech Provider —
 * INSTAGRAM.md §12.1 padrao espelhado; WhatsApp Cloud API + Coexistencia).
 * Funcoes puras sobre o GraphClient compartilhado de @hm/channels
 * (injetavel/mockavel): troca o `code` do Embedded Signup por token long-lived,
 * registra o numero na Cloud API (PIN) e inscreve a WABA no app (subscribed_apps,
 * com os campos de coexistencia quando aplicavel). Nenhuma persistencia aqui — a
 * rota cria o channel e cifra o token.
 *
 * Sem any (narrowing por colchetes), espelhando instagram-connect.ts.
 */
import type { GraphClient } from '@hm/channels';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Erro de dominio do connect WA (exchange, register e subscribe). */
export class WaConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WaConnectError';
    this.code = code;
    Object.setPrototypeOf(this, WaConnectError.prototype);
  }
}

/**
 * Campos de `subscribed_apps` por modo. No Cloud API padrao a WABA so precisa
 * subscrever `messages` (o roteamento de webhooks de mensagens). Em Coexistencia
 * (WhatsApp Business app + Cloud API no mesmo numero) a WABA precisa, alem de
 * `messages`, dos campos de sincronizacao: historico, echoes de mensagens
 * enviadas pelo app SMB e sincronizacao de estado do app SMB.
 *
 * Field names em constantes nomeadas — confirmar contra a doc Graph v23.0
 * vigente da Meta antes do go-live (ver Notas do slot).
 */
export const WA_SUBSCRIBED_FIELD_MESSAGES = 'messages' as const;
export const WA_SUBSCRIBED_FIELD_HISTORY = 'history' as const;
export const WA_SUBSCRIBED_FIELD_SMB_ECHOES = 'smb_message_echoes' as const;
export const WA_SUBSCRIBED_FIELD_SMB_APP_STATE = 'smb_app_state_sync' as const;

export const WA_CLOUD_API_SUBSCRIBED_FIELDS = [WA_SUBSCRIBED_FIELD_MESSAGES] as const;

export const WA_COEXISTENCE_SUBSCRIBED_FIELDS = [
  WA_SUBSCRIBED_FIELD_MESSAGES,
  WA_SUBSCRIBED_FIELD_HISTORY,
  WA_SUBSCRIBED_FIELD_SMB_ECHOES,
  WA_SUBSCRIBED_FIELD_SMB_APP_STATE,
] as const;

export type WaConnectMode = 'cloud_api' | 'coexistence';

/**
 * Troca o `code` do Embedded Signup por um token long-lived da WABA via
 * `GET /oauth/access_token?client_id=...&client_secret=...&code=...`. Esse fluxo
 * nao exige Bearer (o secret vai na query) — passamos string vazia como token.
 * Lanca WaConnectError se a Graph nao devolver `access_token`.
 */
export async function exchangeCodeForToken(
  graph: GraphClient,
  code: string,
  appId: string,
  appSecret: string,
): Promise<string> {
  const qs = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  });
  const res = await graph.get('oauth/access_token?' + qs.toString(), '');
  const token = isRecord(res) ? asString(res['access_token']) : undefined;
  if (token === undefined || token.length === 0) {
    throw new WaConnectError(
      'WA_CONNECT_EXCHANGE_FAILED',
      'A Meta nao devolveu um access_token na troca do code do Embedded Signup.',
    );
  }
  return token;
}

/**
 * Registra o numero na Cloud API: `POST /{phone_number_id}/register`
 * `{ messaging_product: 'whatsapp', pin }`. O `pin` e o 2FA de 6 digitos do
 * numero (definido no Embedded Signup). Idempotente do lado da Meta para um
 * numero ja registrado com o mesmo PIN. Lanca WaConnectError em falha.
 */
export async function registerPhoneNumber(
  graph: GraphClient,
  phoneNumberId: string,
  pin: string,
  token: string,
): Promise<void> {
  const res = await graph.post(
    phoneNumberId + '/register',
    { messaging_product: 'whatsapp', pin },
    token,
  );
  if (isRecord(res) && res['success'] === false) {
    throw new WaConnectError(
      'WA_CONNECT_REGISTER_FAILED',
      'A Meta recusou o register do numero (PIN incorreto ou numero ja registrado em outro app).',
    );
  }
}

/**
 * Inscreve a WABA no app: `POST /{waba_id}/subscribed_apps`. Em `coexistence`
 * envia os campos de coexistencia (history/smb_message_echoes/smb_app_state_sync)
 * alem de `messages`; em `cloud_api` envia apenas `messages`. Sem subscribed_apps
 * a WABA NAO entrega webhooks. Idempotente do lado da Meta. Lanca WaConnectError
 * em falha.
 */
export async function subscribeWabaApp(
  graph: GraphClient,
  wabaId: string,
  token: string,
  opts: { coexistence: boolean },
): Promise<void> {
  const fields = opts.coexistence
    ? WA_COEXISTENCE_SUBSCRIBED_FIELDS
    : WA_CLOUD_API_SUBSCRIBED_FIELDS;
  const res = await graph.post(
    wabaId + '/subscribed_apps',
    { subscribed_fields: fields.join(',') },
    token,
  );
  if (isRecord(res) && res['success'] === false) {
    throw new WaConnectError(
      'WA_CONNECT_SUBSCRIBE_FAILED',
      'A Meta recusou o subscribed_apps da WABA. Sem isso o numero nao entrega webhooks.',
    );
  }
}

/** Numero da WABA como a Graph devolve em `GET /{waba_id}/phone_numbers`. */
export interface WabaPhoneNumber {
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

/** So digitos — para comparar `+55 11 9…` com `5511 9…`. */
function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/**
 * Lista os numeros da WABA com o token do cliente. Serve a dois propositos:
 * provar que o token enxerga a WABA informada e descobrir o `phone_number_id`,
 * que a Meta NAO devolve no `postMessage` da coexistencia
 * (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` so traz `waba_id`).
 */
export async function listWabaPhoneNumbers(
  graph: GraphClient,
  wabaId: string,
  token: string,
): Promise<WabaPhoneNumber[]> {
  const res = await graph.get(
    wabaId + '/phone_numbers?fields=id,display_phone_number,verified_name',
    token,
  );
  const data = isRecord(res) && Array.isArray(res['data']) ? res['data'] : [];
  const out: WabaPhoneNumber[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const id = asString(item['id']);
    if (id === undefined || id.length === 0) continue;
    out.push({
      id,
      displayPhoneNumber: asString(item['display_phone_number']),
      verifiedName: asString(item['verified_name']),
    });
  }
  return out;
}

/**
 * Decide o numero do canal entre os numeros da WABA.
 *
 * - `phoneNumberId` informado: precisa pertencer a WABA (senao o cliente poderia
 *   amarrar ao canal um numero que o token nao controla).
 * - Nao informado: um numero so → ele; varios → o que casa com `phoneNumberHint`
 *   por digitos; sem como decidir → erro pedindo o numero.
 */
export function pickWabaPhoneNumber(
  numbers: readonly WabaPhoneNumber[],
  phoneNumberId: string | undefined,
  phoneNumberHint: string | undefined,
): WabaPhoneNumber {
  if (numbers.length === 0) {
    throw new WaConnectError(
      'WA_CONNECT_NO_PHONE_NUMBER',
      'A conta do WhatsApp (WABA) nao tem nenhum numero visivel para este acesso.',
    );
  }
  if (phoneNumberId !== undefined) {
    const found = numbers.find((n) => n.id === phoneNumberId);
    if (!found) {
      throw new WaConnectError(
        'WA_CONNECT_PHONE_NOT_IN_WABA',
        'O Phone Number ID informado nao pertence a esta conta do WhatsApp (WABA).',
      );
    }
    return found;
  }
  if (numbers.length === 1) return numbers[0] as WabaPhoneNumber;
  const hint = phoneNumberHint !== undefined ? digitsOnly(phoneNumberHint) : '';
  if (hint.length > 0) {
    const matches = numbers.filter(
      (n) => n.displayPhoneNumber !== undefined && digitsOnly(n.displayPhoneNumber) === hint,
    );
    if (matches.length === 1) return matches[0] as WabaPhoneNumber;
  }
  throw new WaConnectError(
    'WA_CONNECT_PHONE_AMBIGUOUS',
    'A conta do WhatsApp tem mais de um numero. Informe o Phone Number ID do numero que deseja conectar.',
  );
}

/**
 * Credencial do cliente: o `code` do Embedded Signup (trocado aqui por token) ou
 * um token de acesso ja emitido (ex.: usuario do sistema do Business Manager),
 * para o conector manual. Nos dois casos o token so vive no servidor.
 */
export type WaConnectCredential = { code: string } | { accessToken: string };

export interface WaConnectParams {
  credential: WaConnectCredential;
  /** Opcional: a coexistencia nao o devolve; resolvido pela WABA. */
  phoneNumberId?: string;
  wabaId: string;
  /** Numero (E.164 ou exibicao) para desempatar WABA com varios numeros. */
  phoneNumberHint?: string;
  /** 2FA de 6 digitos — aceito e ignorado (ver runWhatsAppConnect). */
  pin?: string;
  mode: WaConnectMode;
}

export interface WaConnectResult {
  token: string;
  phoneNumber: WabaPhoneNumber;
}

export interface WaConnectAppCreds {
  appId: string;
  appSecret: string;
}

/**
 * Orquestra o connect WA: exchange → subscribe. **NAO chama `/register` em nenhum
 * modo.**
 *
 * Por que sem register/PIN (confirmado contra a Graph real, 2026-06-20): para a
 * COEXISTENCIA a Meta responde `code 100 "Register endpoint is not available for
 * SMB businesses"` — o numero ja e verificado no app WhatsApp Business durante o
 * Embedded Signup (nao ha 2FA/PIN a registrar via API). Para numero NOVO
 * (`cloud_api`) o proprio Embedded Signup provisiona. Em ambos, so o
 * `subscribed_apps` e necessario para a WABA entregar webhooks (com os campos de
 * coexistencia quando aplicavel). `params.pin` e aceito mas ignorado (compat).
 *
 * Antes de inscrever, lista os numeros da WABA com o token: prova que o token
 * enxerga a WABA e resolve o `phone_number_id` (a coexistencia nao o devolve no
 * Embedded Signup). Retorna o token long-lived e o numero (a rota cifra e persiste).
 */
export async function runWhatsAppConnect(
  graph: GraphClient,
  params: WaConnectParams,
  creds: WaConnectAppCreds,
): Promise<WaConnectResult> {
  const token =
    'code' in params.credential
      ? await exchangeCodeForToken(graph, params.credential.code, creds.appId, creds.appSecret)
      : params.credential.accessToken;
  const numbers = await listWabaPhoneNumbers(graph, params.wabaId, token);
  const phoneNumber = pickWabaPhoneNumber(numbers, params.phoneNumberId, params.phoneNumberHint);
  const coexistence = params.mode === 'coexistence';
  await subscribeWabaApp(graph, params.wabaId, token, { coexistence });
  return { token, phoneNumber };
}
