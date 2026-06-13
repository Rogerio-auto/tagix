/**
 * Orquestracao Graph do connect Instagram (Embedded Signup / Tech Provider —
 * INSTAGRAM.md 2, 12.1). Funcoes puras sobre o GraphClient compartilhado de
 * @hm/channels (injetavel/mockavel): listar Paginas + IGBA vinculada, validar
 * Business/Creator (rejeita Personal), subscrever Page+IGBA no webhook do app e
 * enviar a mensagem de teste. Nenhuma persistencia aqui (a rota cria o channel).
 *
 * Sem any (narrowing por colchetes).
 */
import type { GraphClient } from '@hm/channels';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Conta IG candidata exposta ao wizard (uma Pagina FB + IGBA vinculada). */
export interface IgAccountCandidate {
  readonly pageId: string;
  readonly pageName?: string;
  readonly pageAccessToken: string;
  readonly igUserId: string;
  readonly igUsername?: string;
  readonly igAccountType?: 'business' | 'creator';
}

/** Erro de dominio do connect IG (rejeicao de Personal, conta ausente, etc.). */
export class IgConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IgConnectError';
    this.code = code;
    Object.setPrototypeOf(this, IgConnectError.prototype);
  }
}

function mapAccountType(v: unknown): 'business' | 'creator' | undefined {
  const s = asString(v);
  if (s === 'BUSINESS' || s === 'business') return 'business';
  if (s === 'CREATOR' || s === 'creator') return 'creator';
  return undefined;
}

/**
 * Lista as Paginas FB do usuario (token de usuario) e, para cada uma com IGBA
 * vinculada, devolve a conta candidata. So inclui contas Business/Creator —
 * Personal e descartada (INSTAGRAM.md 17). Lanca IgConnectError se nenhuma
 * conta IG elegivel existir.
 */
export async function listInstagramAccounts(
  graph: GraphClient,
  userAccessToken: string,
): Promise<IgAccountCandidate[]> {
  const fields =
    'id,name,access_token,instagram_business_account{id,username,account_type}';
  const res = await graph.get('me/accounts?fields=' + encodeURIComponent(fields), userAccessToken);
  if (!isRecord(res)) {
    throw new IgConnectError('IG_CONNECT_NO_PAGES', 'Nenhuma Pagina retornada pela Graph.');
  }
  const data = asArray(res['data']).filter(isRecord);
  const candidates: IgAccountCandidate[] = [];

  for (const page of data) {
    const igba = isRecord(page['instagram_business_account'])
      ? page['instagram_business_account']
      : undefined;
    const igUserId = igba ? asString(igba['id']) : undefined;
    const pageId = asString(page['id']);
    const pageToken = asString(page['access_token']);
    if (igUserId === undefined || pageId === undefined || pageToken === undefined) continue;

    const accountType = igba ? mapAccountType(igba['account_type']) : undefined;
    // account_type ausente: a Graph nem sempre devolve; tratamos como elegivel
    // (a IGBA so existe para Business/Creator). Personal nao tem IGBA.
    const username = igba ? asString(igba['username']) : undefined;
    candidates.push({
      pageId,
      ...(asString(page['name']) !== undefined ? { pageName: asString(page['name']) as string } : {}),
      pageAccessToken: pageToken,
      igUserId,
      ...(username !== undefined ? { igUsername: username } : {}),
      ...(accountType !== undefined ? { igAccountType: accountType } : {}),
    });
  }

  if (candidates.length === 0) {
    throw new IgConnectError(
      'IG_CONNECT_NO_BUSINESS_ACCOUNT',
      'Nenhuma conta Instagram Business/Creator vinculada a uma Pagina foi encontrada. Contas Personal nao sao suportadas.',
    );
  }
  return candidates;
}

/**
 * Subscreve a Pagina (e por consequencia a IGBA) nos campos do webhook do app
 * (INSTAGRAM.md 12.1 step 4). Usa o page access token. Idempotente do lado da
 * Meta. Lanca IgConnectError em falha.
 */
export async function subscribeInstagramWebhook(
  graph: GraphClient,
  pageId: string,
  pageAccessToken: string,
): Promise<void> {
  const subscribedFields = [
    'messages',
    'messaging_postbacks',
    'messaging_seen',
    'message_reactions',
    'comments',
    'mentions',
  ].join(',');
  await graph.post(
    pageId + '/subscribed_apps',
    { subscribed_fields: subscribedFields },
    pageAccessToken,
  );
}

/**
 * Envia a mensagem de teste do connect (INSTAGRAM.md 12.1 step 5) ao proprio
 * IGSID alvo. Devolve true se enviada. Best-effort: o caller decide se uma
 * falha aqui impede ativar o canal.
 */
export async function sendInstagramTestMessage(
  graph: GraphClient,
  igUserId: string,
  recipientIgsid: string,
  pageAccessToken: string,
  text = 'Ola do Highermind! Seu Instagram esta conectado.',
): Promise<boolean> {
  const res = await graph.post(
    igUserId + '/messages',
    { recipient: { id: recipientIgsid }, message: { text }, messaging_type: 'RESPONSE' },
    pageAccessToken,
  );
  return isRecord(res) && (typeof res['message_id'] === 'string' || typeof res['recipient_id'] === 'string');
}
