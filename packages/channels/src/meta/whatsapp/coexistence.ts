/**
 * Parsers de coexistência da WhatsApp Business (F39-S03).
 *
 * A "coexistência" liga o número do app WhatsApp Business (SMB) à Cloud API ao
 * mesmo tempo. Além de `messages`, a Meta passa a entregar três `field`s extra
 * no webhook da WABA:
 *
 *   - `smb_message_echoes` / `message_echoes`  → ecos de mensagens que o OPERADOR
 *     enviou pelo APP WhatsApp Business (não pela nossa API). Precisamos
 *     reconciliar essas mensagens outbound na timeline.
 *   - `history`                                → lotes de histórico de contatos e
 *     conversas anteriores do número (backfill on-demand do app local).
 *   - `smb_app_state_sync`                     → estado do número/sessão de
 *     coexistência (ex.: vínculo iniciado/concluído, contatos sincronizando).
 *
 * Este módulo é PURO (sem rede/Meta real, sem `any`): navega o envelope por
 * colchetes com narrowing seguro e devolve estruturas normalizadas e
 * idempotente-friendly (sempre com ids externos estáveis quando existirem).
 *
 * Os tipos exportados aqui são o CONTRATO consumido pelo worker de persistência
 * (F39-S04). O schema Zod equivalente vive em `@hm/shared/mq` (topology) — a
 * borda publica, o worker valida.
 */

// --- Helpers de narrowing (sem `any`) ---

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Normaliza um timestamp WA (epoch em segundos, número ou string) para epoch em
 * segundos (number). Mantém `undefined` se ausente/inválido. O worker decide o
 * formato de persistência — a borda só carrega o valor estável.
 */
function toEpochSeconds(v: unknown): number | undefined {
  return asNumber(v);
}

// --- Contrato: ECHO (smb_message_echoes) ---

/**
 * Um eco de mensagem enviada pelo operador via app WhatsApp Business. Carrega o
 * id externo (`wamid`) para reconciliação idempotente na timeline outbound.
 */
export interface CoexistenceEcho {
  /** `phone_number_id` da WABA (metadata.phone_number_id). */
  readonly phoneNumberId: string;
  /** `wamid` da mensagem ecoada — chave de idempotência. */
  readonly externalId: string;
  /** Destinatário (wa_id / E.164 sem +) da mensagem enviada pelo app. */
  readonly to: string;
  /** Tipo WA cru (`text`, `image`, ...). */
  readonly type: string;
  /** Texto exibível, quando aplicável (text.body / caption). */
  readonly text?: string;
  /** Epoch em segundos da mensagem, quando presente. */
  readonly timestamp?: number;
  /** Objeto cru da mensagem ecoada (o worker extrai mídia/metadados). */
  readonly raw: JsonRecord;
}

// --- Contrato: HISTORY (history) ---

/** Um contato dentro de um batch de histórico. */
export interface CoexistenceHistoryContact {
  /** wa_id / E.164 sem + — chave de idempotência do contato. */
  readonly waId: string;
  /** Nome de perfil, quando informado. */
  readonly name?: string;
  /** Objeto cru do contato. */
  readonly raw: JsonRecord;
}

/** Uma mensagem histórica dentro de um batch. */
export interface CoexistenceHistoryMessage {
  /** `wamid` — chave de idempotência da mensagem. */
  readonly externalId: string;
  /** Remetente (wa_id) — pode ser o próprio número (outbound) ou o contato. */
  readonly from?: string;
  /** Destinatário (wa_id), quando a Meta o fornece em mensagens outbound. */
  readonly to?: string;
  /** Tipo WA cru. */
  readonly type?: string;
  /** Texto exibível, quando aplicável. */
  readonly text?: string;
  /** Epoch em segundos, quando presente. */
  readonly timestamp?: number;
  /**
   * Direção declarada pelo envelope de history, quando presente
   * (`from_me`/`is_from_me`/`direction`). `undefined` = o worker infere.
   */
  readonly fromMe?: boolean;
  /** Objeto cru da mensagem histórica. */
  readonly raw: JsonRecord;
}

/**
 * Um batch de histórico de UMA WABA. Idempotente-friendly: o worker pode
 * reprocessar usando os ids externos dos contatos/mensagens.
 */
export interface CoexistenceHistoryBatch {
  /** `phone_number_id` da WABA. */
  readonly phoneNumberId: string;
  /**
   * Fase do backfill quando a Meta a informa (`initial`/`incremental`/...).
   * Apenas observacional — não altera a idempotência.
   */
  readonly phase?: string;
  readonly contacts: readonly CoexistenceHistoryContact[];
  readonly messages: readonly CoexistenceHistoryMessage[];
  /** Objeto cru do `history` (o worker pode extrair campos adicionais). */
  readonly raw: JsonRecord;
}

// --- Contrato: APP STATE (smb_app_state_sync) ---

/** Estado do número/sessão de coexistência. */
export interface CoexistenceAppState {
  /** `phone_number_id` da WABA. */
  readonly phoneNumberId: string;
  /**
   * Estado cru reportado pela Meta (ex.: `state`/`status`/`event`). Mantido como
   * string opaca — o worker mapeia para o domínio.
   */
  readonly state: string;
  /** Objeto cru do `smb_app_state_sync`. */
  readonly raw: JsonRecord;
}

// --- Resultado agregado de um envelope ---

export interface CoexistenceParseResult {
  readonly echoes: readonly CoexistenceEcho[];
  readonly history: readonly CoexistenceHistoryBatch[];
  readonly appStates: readonly CoexistenceAppState[];
}

/** Fields de coexistência reconhecidos (rotear a este parser). */
const ECHO_FIELDS = new Set(['smb_message_echoes', 'message_echoes']);
const HISTORY_FIELDS = new Set(['history']);
const APP_STATE_FIELDS = new Set(['smb_app_state_sync']);

/** Indica se um `change.field` é de coexistência (qualquer um dos 3 grupos). */
export function isCoexistenceField(field: unknown): boolean {
  return (
    typeof field === 'string' &&
    (ECHO_FIELDS.has(field) || HISTORY_FIELDS.has(field) || APP_STATE_FIELDS.has(field))
  );
}

/** Extrai o `phone_number_id` do `value.metadata`. */
function phoneNumberIdOf(value: JsonRecord): string | undefined {
  const metadata = value['metadata'];
  if (!isRecord(metadata)) return undefined;
  return asString(metadata['phone_number_id']);
}

/** Texto exibível de uma mensagem WA crua (text.body ou caption de mídia). */
function textOf(msg: JsonRecord, waType: string | undefined): string | undefined {
  const text = msg['text'];
  if (isRecord(text)) {
    const body = asString(text['body']);
    if (body !== undefined) return body;
  }
  if (waType !== undefined) {
    const media = msg[waType];
    if (isRecord(media)) {
      const caption = asString(media['caption']);
      if (caption !== undefined) return caption;
    }
  }
  return undefined;
}

/** Parseia os echoes de um único `change.value`. */
function parseEchoValue(value: JsonRecord): CoexistenceEcho[] {
  const phoneNumberId = phoneNumberIdOf(value);
  if (phoneNumberId === undefined) return [];

  // A Meta entrega os ecos em `message_echoes` dentro do value.
  const list = asArray(value['message_echoes']);
  const out: CoexistenceEcho[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const externalId = asString(item['id']);
    const to = asString(item['to']) ?? asString(item['recipient_id']);
    if (externalId === undefined || to === undefined) continue;
    const waType = asString(item['type']) ?? 'unknown';
    const text = textOf(item, asString(item['type']));
    const timestamp = toEpochSeconds(item['timestamp']);
    out.push({
      phoneNumberId,
      externalId,
      to,
      type: waType,
      ...(text !== undefined ? { text } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      raw: item,
    });
  }
  return out;
}

/** Lê a direção declarada de uma mensagem histórica, se houver. */
function fromMeOf(msg: JsonRecord): boolean | undefined {
  for (const key of ['from_me', 'is_from_me'] as const) {
    const v = msg[key];
    if (typeof v === 'boolean') return v;
  }
  const direction = asString(msg['direction']);
  if (direction === 'outbound' || direction === 'sent') return true;
  if (direction === 'inbound' || direction === 'received') return false;
  return undefined;
}

/** Parseia um batch de history de um único `change.value`. */
function parseHistoryValue(value: JsonRecord): CoexistenceHistoryBatch | undefined {
  const phoneNumberId = phoneNumberIdOf(value);
  if (phoneNumberId === undefined) return undefined;

  const history = value['history'];
  if (!isRecord(history)) {
    // Alguns envelopes podem trazer `history` como array de threads.
    const arr = asArray(value['history']);
    if (arr.length === 0) return undefined;
    return collectHistory(phoneNumberId, { threads: arr }, value);
  }
  return collectHistory(phoneNumberId, history, value);
}

/**
 * Coleta contatos/mensagens de um objeto `history`, tolerando dois shapes
 * plausíveis: (a) `{ contacts, messages }` direto, ou (b) `{ threads: [{ contact,
 * messages }] }`. Achatamos tudo para a estrutura normalizada.
 */
function collectHistory(
  phoneNumberId: string,
  history: JsonRecord,
  rawValue: JsonRecord,
): CoexistenceHistoryBatch {
  const contacts: CoexistenceHistoryContact[] = [];
  const messages: CoexistenceHistoryMessage[] = [];

  for (const c of asArray(history['contacts'])) collectContact(c, contacts);
  for (const m of asArray(history['messages'])) collectMessage(m, messages);

  for (const thread of asArray(history['threads'])) {
    if (!isRecord(thread)) continue;
    collectContact(thread['contact'], contacts);
    for (const c of asArray(thread['contacts'])) collectContact(c, contacts);
    for (const m of asArray(thread['messages'])) collectMessage(m, messages);
  }

  const phase = asString(history['phase']) ?? asString(history['type']);

  return {
    phoneNumberId,
    ...(phase !== undefined ? { phase } : {}),
    contacts,
    messages,
    raw: rawValue,
  };
}

function collectContact(c: unknown, into: CoexistenceHistoryContact[]): void {
  if (!isRecord(c)) return;
  const waId = asString(c['wa_id']) ?? asString(c['id']);
  if (waId === undefined) return;
  const profile = c['profile'];
  const name = (isRecord(profile) ? asString(profile['name']) : undefined) ?? asString(c['name']);
  into.push({ waId, ...(name !== undefined ? { name } : {}), raw: c });
}

function collectMessage(m: unknown, into: CoexistenceHistoryMessage[]): void {
  if (!isRecord(m)) return;
  const externalId = asString(m['id']);
  if (externalId === undefined) return;
  const type = asString(m['type']);
  const from = asString(m['from']);
  const to = asString(m['to']) ?? asString(m['recipient_id']);
  const text = textOf(m, type);
  const timestamp = toEpochSeconds(m['timestamp']);
  const fromMe = fromMeOf(m);
  into.push({
    externalId,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(fromMe !== undefined ? { fromMe } : {}),
    raw: m,
  });
}

/** Parseia o app_state de um único `change.value`. */
function parseAppStateValue(value: JsonRecord): CoexistenceAppState | undefined {
  const phoneNumberId = phoneNumberIdOf(value);
  if (phoneNumberId === undefined) return undefined;

  const sync = value['smb_app_state_sync'];
  const syncRecord = isRecord(sync) ? sync : value;
  const state =
    asString(syncRecord['state']) ??
    asString(syncRecord['status']) ??
    asString(syncRecord['event']);
  if (state === undefined) return undefined;

  return { phoneNumberId, state, raw: syncRecord };
}

/**
 * Parseia um envelope WA completo extraindo APENAS os campos de coexistência.
 * Tolerante: ignora entries/changes sem campos de coexistência (não lança).
 *
 * `messages`/`statuses` inbound são ignorados aqui — o parser inbound padrão
 * (`parseWhatsAppWebhook`) cuida deles.
 */
export function parseCoexistence(payload: unknown): CoexistenceParseResult {
  const echoes: CoexistenceEcho[] = [];
  const history: CoexistenceHistoryBatch[] = [];
  const appStates: CoexistenceAppState[] = [];

  if (!isRecord(payload) || payload['object'] !== 'whatsapp_business_account') {
    return { echoes, history, appStates };
  }

  for (const entry of asArray(payload['entry'])) {
    if (!isRecord(entry)) continue;
    for (const change of asArray(entry['changes'])) {
      if (!isRecord(change)) continue;
      const field = asString(change['field']);
      const value = change['value'];
      if (field === undefined || !isRecord(value)) continue;

      if (ECHO_FIELDS.has(field)) {
        echoes.push(...parseEchoValue(value));
      } else if (HISTORY_FIELDS.has(field)) {
        const batch = parseHistoryValue(value);
        if (batch !== undefined) history.push(batch);
      } else if (APP_STATE_FIELDS.has(field)) {
        const state = parseAppStateValue(value);
        if (state !== undefined) appStates.push(state);
      }
    }
  }

  return { echoes, history, appStates };
}

/** `true` se o envelope contém ao menos um campo de coexistência reconhecido. */
export function hasCoexistenceFields(payload: unknown): boolean {
  if (!isRecord(payload) || payload['object'] !== 'whatsapp_business_account') return false;
  for (const entry of asArray(payload['entry'])) {
    if (!isRecord(entry)) continue;
    for (const change of asArray(entry['changes'])) {
      if (isRecord(change) && isCoexistenceField(change['field'])) return true;
    }
  }
  return false;
}
