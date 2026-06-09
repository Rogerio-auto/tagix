/**
 * Parser do webhook WhatsApp Cloud API → `InboundEvent[]`.
 *
 * Envelope WA:
 *   { object: 'whatsapp_business_account',
 *     entry: [{ id, changes: [{ field: 'messages',
 *       value: { messaging_product, metadata, contacts?, messages?, statuses? } }] }] }
 *
 * Cobre mensagens (text/image/video/audio/voice/document/sticker/location/
 * contacts/interactive/reaction) e status (sent/delivered/read/failed).
 * Tudo navegado por colchetes com narrowing seguro (sem `any`).
 */

import type { InboundEvent, MediaRef, MessageType } from '../../types';

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
    default:
      return undefined;
  }
}

/**
 * Extrai metadados extra que o worker inbound usa (contexto de reply, payload
 * interativo, localização, contatos). Mantém `undefined` quando vazio.
 */
function extractMetadata(waType: string | undefined, msg: JsonRecord): Record<string, unknown> | undefined {
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
  if (waType === 'location') {
    const location = msg['location'];
    if (isRecord(location)) meta['location'] = location;
  }
  if (waType === 'contacts') {
    const contacts = msg['contacts'];
    if (Array.isArray(contacts)) meta['contacts'] = contacts;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Constrói o evento de uma mensagem inbound WA. */
function parseMessage(msg: JsonRecord): InboundEvent | undefined {
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

  const messageType = mapMessageType(waType, msg);
  const content = extractContent(waType, msg);
  const mediaRef =
    waType !== undefined ? extractMediaRef(msg[waType]) : undefined;
  const metadata = extractMetadata(waType, msg);

  return {
    type: 'message',
    provider: PROVIDER,
    contactRemoteId: from,
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
      const value = change['value'];
      if (!isRecord(value)) continue;

      for (const msg of asArray(value['messages'])) {
        if (!isRecord(msg)) continue;
        const event = parseMessage(msg);
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
