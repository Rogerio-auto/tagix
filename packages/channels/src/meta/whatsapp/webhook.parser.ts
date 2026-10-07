/**
 * Parser do webhook WhatsApp Cloud API → `InboundEvent[]`.
 *
 * Envelope WA:
 *   { object: 'whatsapp_business_account',
 *     entry: [{ id, changes: [{ field: 'messages',
 *       value: { messaging_product, metadata, contacts?, messages?, statuses? } }] }] }
 *
 * Cobre mensagens (text/image/video/audio/voice/document/sticker/location/
 * contacts/interactive/button/reaction) e status (sent/delivered/read/failed).
 *
 * F70-S34 — clique em resposta rápida. O botão de resposta rápida de um MODELO chega
 * como `type: 'button'` (`button.text` + `button.payload`); o botão de uma mensagem
 * interativa, como `interactive.button_reply` (`id` + `title`) ou `list_reply`. Nos
 * dois casos o texto do botão vira o `content` (é o que o contato "disse") e o clique
 * cru vai em `metadata.quickReply` (`{ source, text, payload? }`). Quem decide o que o
 * clique SIGNIFICA é o inbound (`@hm/flow-engine`, `quick-replies.ts`), não o parser.
 * Tudo navegado por colchetes com narrowing seguro (sem `any`).
 */

import type { InboundEvent, MediaRef, MessageType } from '../../types';
import { parseWhatsAppReferral } from './ad-referral';
import { isCoexistenceField } from './coexistence';

// Re-export do contrato/parser de coexistência (F39-S03) para que callers do
// parser WA tenham um ponto único de entrada (`./webhook.parser`).
export {
  parseCoexistence,
  hasCoexistenceFields,
  isCoexistenceField,
} from './coexistence';
export type {
  CoexistenceParseResult,
  CoexistenceEcho,
  CoexistenceHistoryBatch,
  CoexistenceHistoryContact,
  CoexistenceHistoryMessage,
  CoexistenceAppState,
} from './coexistence';

// F70-S05: atribuição de anúncio e origem da conversa — mesmo ponto de entrada.
export {
  parseWhatsAppReferral,
  parseInstagramReferral,
  readAdReferral,
  isPaidAdReferral,
  toAdAttributionColumns,
} from './ad-referral';
export type {
  AdReferral,
  AdReferralChannel,
  AdReferralSourceType,
  AdAttributionColumns,
} from './ad-referral';
export {
  classifyConversationOrigin,
  isAiEligibleOrigin,
  adReferralFromInboundEvent,
  CONVERSATION_ORIGIN_TAGS,
  MIN_PREFILL_MARKER_LENGTH,
} from './origin';
export type { ConversationOrigin, ConversationOriginInput, OriginPrefillMarkers } from './origin';

const PROVIDER = 'meta_whatsapp' as const;

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

/**
 * Converte timestamp WA (epoch em segundos, string) para ISO-8601. Mantém o
 * valor bruto se não for numérico.
 */
function toIso(rawTs: unknown): string {
  const s = asString(rawTs) ?? (typeof rawTs === 'number' ? String(rawTs) : undefined);
  if (s === undefined) return new Date().toISOString();
  const secs = Number(s);
  if (!Number.isFinite(secs)) return s;
  return new Date(secs * 1000).toISOString();
}

/** Mapeia o `messages[].type` do WA para o `MessageType` canônico. */
function mapMessageType(waType: string | undefined, msg: JsonRecord): MessageType {
  switch (waType) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    case 'location':
      return 'location';
    case 'contacts':
      return 'contact';
    case 'interactive':
      return 'interactive';
    // F70-S34: clique em resposta rápida de modelo. Antes caía em `system` e a bolha
    // aparecia como nota de sistema, sem autor; é o contato respondendo com o texto
    // do botão, então é texto.
    case 'button':
      return 'text';
    case 'reaction':
      return 'reaction';
    case 'audio': {
      // WA marca PTT com `audio.voice === true`.
      const audio = msg['audio'];
      if (isRecord(audio) && audio['voice'] === true) return 'voice';
      return 'audio';
    }
    default:
      return 'system';
  }
}

/** Extrai a `MediaRef` (media_id + mime + sha + filename) de uma mídia WA. */
function extractMediaRef(media: unknown): MediaRef | undefined {
  if (!isRecord(media)) return undefined;
  const id = asString(media['id']);
  if (id === undefined) return undefined;
  const ref: MediaRef = {
    refOrUrl: id,
    ...(asString(media['mime_type']) !== undefined ? { mimeType: asString(media['mime_type']) } : {}),
    ...(asString(media['sha256']) !== undefined ? { sha256: asString(media['sha256']) } : {}),
    ...(asString(media['filename']) !== undefined ? { fileName: asString(media['filename']) } : {}),
  };
  return ref;
}

/** Texto exibível conforme o tipo (caption de mídia, corpo, etc.). */
function extractContent(waType: string | undefined, msg: JsonRecord): string | undefined {
  switch (waType) {
    case 'text': {
      const text = msg['text'];
      return isRecord(text) ? asString(text['body']) : undefined;
    }
    case 'image':
    case 'video':
    case 'document': {
      const media = msg[waType];
      return isRecord(media) ? asString(media['caption']) : undefined;
    }
    case 'button': {
      const button = msg['button'];
      return isRecord(button) ? asString(button['text']) : undefined;
    }
    case 'interactive':
      return readInteractiveReply(msg)?.text;
    default:
      return undefined;
  }
}

/** Clique cru numa resposta rápida (F70-S34). O significado é decidido no inbound. */
interface WhatsAppQuickReplyClick {
  /** `button` = resposta rápida de modelo; `interactive` = botão/lista de mensagem interativa. */
  readonly source: 'button' | 'interactive';
  /** Texto do botão, como o contato viu. */
  readonly text: string;
  /** `button.payload` do modelo ou `id` do botão/linha interativa, quando vier. */
  readonly payload?: string;
}

/** `interactive.button_reply` / `interactive.list_reply` → `{ id, title }`. */
function readInteractiveReply(msg: JsonRecord): { text: string; payload?: string } | undefined {
  const interactive = msg['interactive'];
  if (!isRecord(interactive)) return undefined;
  const kind = asString(interactive['type']);
  if (kind !== 'button_reply' && kind !== 'list_reply') return undefined;
  const reply = interactive[kind];
  if (!isRecord(reply)) return undefined;
  const text = asString(reply['title']);
  if (text === undefined || text.trim() === '') return undefined;
  const payload = asString(reply['id']);
  return payload !== undefined && payload !== '' ? { text, payload } : { text };
}

/** Clique de resposta rápida da mensagem, se for um. */
function readQuickReplyClick(
  waType: string | undefined,
  msg: JsonRecord,
): WhatsAppQuickReplyClick | undefined {
  if (waType === 'button') {
    const button = msg['button'];
    if (!isRecord(button)) return undefined;
    const text = asString(button['text']);
    if (text === undefined || text.trim() === '') return undefined;
    const payload = asString(button['payload']);
    return payload !== undefined && payload !== ''
      ? { source: 'button', text, payload }
      : { source: 'button', text };
  }
  if (waType === 'interactive') {
    const reply = readInteractiveReply(msg);
    return reply === undefined ? undefined : { source: 'interactive', ...reply };
  }
  return undefined;
}

/**
 * Extrai metadados extra que o worker inbound usa (contexto de reply, payload
 * interativo, localização, contatos). Mantém `undefined` quando vazio.
 */
function extractMetadata(
  waType: string | undefined,
  msg: JsonRecord,
  rawTimestamp: string,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};

  // Contexto de reply (mensagem citada).
  const context = msg['context'];
  if (isRecord(context)) {
    const replyTo = asString(context['id']);
    if (replyTo !== undefined) meta['replyToExternalId'] = replyTo;
  }

  if (waType === 'interactive') {
    const interactive = msg['interactive'];
    if (isRecord(interactive)) meta['interactive'] = interactive;
  }
  // F70-S34: clique em resposta rápida (modelo ou interativa), cru.
  const quickReply = readQuickReplyClick(waType, msg);
  if (quickReply !== undefined) meta['quickReply'] = quickReply;
  if (waType === 'location') {
    const location = msg['location'];
    if (isRecord(location)) meta['location'] = location;
  }
  if (waType === 'contacts') {
    const contacts = msg['contacts'];
    if (Array.isArray(contacts)) meta['contacts'] = contacts;
  }

  // F70-S05: Click-to-WhatsApp. Vem em QUALQUER tipo de mensagem (texto, mídia,
  // botão) — é a primeira mensagem depois do clique no anúncio.
  const adReferral = parseWhatsAppReferral(msg['referral'], rawTimestamp);
  if (adReferral !== undefined) meta['adReferral'] = adReferral;

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Constrói o evento de uma mensagem inbound WA. */
/**
 * Índice `wa_id → profile.name` construído a partir de `value.contacts[]`.
 *
 * O WhatsApp manda o perfil do remetente FORA do objeto da mensagem, num array
 * irmão de `messages`. Um `value` pode conter várias mensagens de contatos
 * diferentes, então casamos por `wa_id` — nunca assumimos `contacts[0]`.
 */
type ProfileNames = ReadonlyMap<string, string>;

function parseProfileNames(value: JsonRecord): ProfileNames {
  const nomes = new Map<string, string>();
  for (const c of asArray(value['contacts'])) {
    if (!isRecord(c)) continue;
    const waId = asString(c['wa_id']);
    const profile = c['profile'];
    const nome = isRecord(profile) ? asString(profile['name']) : undefined;
    // Nome vazio ou só espaço não é nome: gravá-lo trocaria "sem nome" por
    // "com nome em branco", que é pior — some da UI e some do diagnóstico.
    if (waId === undefined || nome === undefined || nome.trim() === '') continue;
    nomes.set(waId, nome.trim());
  }
  return nomes;
}

function parseMessage(msg: JsonRecord, profileNames?: ProfileNames): InboundEvent | undefined {
  const externalId = asString(msg['id']);
  const from = asString(msg['from']);
  if (externalId === undefined || from === undefined) return undefined;

  const waType = asString(msg['type']);
  const rawTimestamp = toIso(msg['timestamp']);

  // Reação é um evento dedicado no InboundEvent.
  if (waType === 'reaction') {
    const reaction = msg['reaction'];
    const targetExternalId = isRecord(reaction) ? asString(reaction['message_id']) : undefined;
    const emoji = isRecord(reaction) ? asString(reaction['emoji']) : undefined;
    if (targetExternalId === undefined) return undefined;
    return {
      type: 'reaction',
      provider: PROVIDER,
      contactRemoteId: from,
      targetExternalId,
      emoji: emoji ?? '',
    };
  }

  let messageType = mapMessageType(waType, msg);
  let content = extractContent(waType, msg);

  // Defensivo: alguns inbounds chegam com `type` inesperado/ausente (variações da
  // Cloud API e da coexistência) MAS carregam `text.body`. Sem isto o texto virava
  // uma bolha `system` vazia — a mensagem do contato era PERDIDA. Se há corpo de
  // texto, tratamos como texto em vez de descartar.
  if (messageType === 'system') {
    const text = msg['text'];
    const body = isRecord(text) ? asString(text['body']) : undefined;
    if (body !== undefined && body.length > 0) {
      messageType = 'text';
      content = body;
    }
  }

  const mediaRef =
    waType !== undefined ? extractMediaRef(msg[waType]) : undefined;
  const baseMeta = extractMetadata(waType, msg, rawTimestamp);
  // Diagnóstico: se o tipo continua desconhecido (cai em `system`), preserva o
  // `type` cru da Meta em metadata — permite investigar sem depender do raw
  // webhook (que não é persistido).
  const metadata =
    messageType === 'system'
      ? { ...(baseMeta ?? {}), unknownWaType: waType ?? '<missing>' }
      : baseMeta;

  const contactName = profileNames?.get(from);

  return {
    type: 'message',
    provider: PROVIDER,
    contactRemoteId: from,
    ...(contactName !== undefined ? { contactName } : {}),
    externalId,
    messageType,
    ...(content !== undefined ? { content } : {}),
    ...(mediaRef !== undefined ? { mediaRef } : {}),
    rawTimestamp,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/** Mapeia o `statuses[].status` do WA para o status canônico. */
function mapStatus(waStatus: string | undefined): 'sent' | 'delivered' | 'read' | 'failed' | undefined {
  switch (waStatus) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return undefined;
  }
}

/** Constrói o evento de status (entrega/leitura) WA. */
function parseStatus(status: JsonRecord): InboundEvent | undefined {
  const externalId = asString(status['id']);
  const mapped = mapStatus(asString(status['status']));
  if (externalId === undefined || mapped === undefined) return undefined;
  return {
    type: 'status',
    provider: PROVIDER,
    externalId,
    status: mapped,
    rawTimestamp: toIso(status['timestamp']),
  };
}

/**
 * Parseia o envelope completo do webhook WA num array de `InboundEvent`.
 * Tolerante: campos ausentes/ malformados são ignorados em vez de lançar.
 */
export function parseWhatsAppWebhook(payload: unknown): InboundEvent[] {
  if (!isRecord(payload)) return [];
  if (payload['object'] !== 'whatsapp_business_account') return [];

  const events: InboundEvent[] = [];

  for (const entry of asArray(payload['entry'])) {
    if (!isRecord(entry)) continue;
    for (const change of asArray(entry['changes'])) {
      if (!isRecord(change)) continue;
      // Campos de coexistência (echoes/history/app_state) têm parser dedicado
      // (`parseCoexistence`); aqui só tratamos `messages`/`statuses` inbound.
      if (isCoexistenceField(change['field'])) continue;
      const value = change['value'];
      if (!isRecord(value)) continue;

      // Perfis primeiro: `messages` e `contacts` são irmãos no mesmo `value`.
      const profileNames = parseProfileNames(value);

      for (const msg of asArray(value['messages'])) {
        if (!isRecord(msg)) continue;
        const event = parseMessage(msg, profileNames);
        if (event !== undefined) events.push(event);
      }

      for (const status of asArray(value['statuses'])) {
        if (!isRecord(status)) continue;
        const event = parseStatus(status);
        if (event !== undefined) events.push(event);
      }
    }
  }

  return events;
}
