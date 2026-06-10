/**
 * Parser do webhook WAHA → `InboundEvent[]`.
 *
 * Envelope WAHA (`POST /webhooks/waha`):
 *   { event: 'message' | 'message.any' | 'message.ack' | ...,
 *     session: 'default',
 *     payload: {
 *       id, from, to, body?, timestamp,
 *       type?, _data?: { type },              // tipo da mídia/mensagem
 *       hasMedia?, media?: { url, mimetype, filename },
 *       location?: { latitude, longitude, ... },
 *       ack?, ackName?                         // eventos de status
 *     } }
 *
 * Cobre mensagens (text/image/video/audio/voice/document/sticker/location) e
 * acks (sent/delivered/read). Tudo navegado por colchetes com narrowing seguro
 * (sem `any`). Tolerante: campos ausentes/malformados são ignorados.
 */

import type { InboundEvent, MediaRef, MessageType } from '../types';

const PROVIDER = 'waha' as const;

// --- Helpers de narrowing (sem `any`) ---

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Converte o timestamp WAHA (epoch em segundos) para ISO-8601. Aceita number
 * ou string numérica; mantém string crua se não-numérica.
 */
function toIso(rawTs: unknown): string {
  const n = asNumber(rawTs);
  if (n !== undefined) return new Date(n * 1000).toISOString();
  const s = asString(rawTs);
  if (s === undefined) return new Date().toISOString();
  const secs = Number(s);
  if (!Number.isFinite(secs)) return s;
  return new Date(secs * 1000).toISOString();
}

/**
 * Mapeia o tipo de mensagem WAHA (whatsapp-web.js) para o `MessageType`
 * canônico. WAHA reporta o tipo em `payload.type` ou `payload._data.type`.
 *  - `ptt` (push-to-talk) → voice; `audio` → audio.
 *  - `chat` → text.
 */
function mapMessageType(wahaType: string | undefined): MessageType {
  switch (wahaType) {
    case 'chat':
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'ptt':
    case 'voice':
      return 'voice';
    case 'audio':
      return 'audio';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    case 'location':
      return 'location';
    default:
      return 'system';
  }
}

/** Resolve o tipo bruto a partir de `payload.type` ou `payload._data.type`. */
function resolveRawType(payload: JsonRecord): string | undefined {
  const direct = asString(payload['type']);
  if (direct !== undefined) return direct;
  const data = payload['_data'];
  return isRecord(data) ? asString(data['type']) : undefined;
}

/** Extrai a `MediaRef` (URL + mime + filename) de `payload.media`. */
function extractMediaRef(payload: JsonRecord): MediaRef | undefined {
  const media = payload['media'];
  if (!isRecord(media)) return undefined;
  const url = asString(media['url']);
  if (url === undefined) return undefined;
  const mimeType = asString(media['mimetype']);
  const fileName = asString(media['filename']);
  return {
    refOrUrl: url,
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(fileName !== undefined ? { fileName } : {}),
  };
}

/** Texto exibível: `body` para texto/caption (WAHA usa `body` em ambos). */
function extractContent(payload: JsonRecord): string | undefined {
  return asString(payload['body']);
}

/**
 * Metadados extra que o worker inbound consome: contexto de reply, localização
 * e o nome de exibição do contato. `undefined` quando vazio.
 */
function extractMetadata(payload: JsonRecord, messageType: MessageType): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};

  // Reply: WAHA expõe `replyTo` ou `_data.quotedMsg`.
  const replyTo = asString(payload['replyTo']);
  if (replyTo !== undefined) meta['replyToExternalId'] = replyTo;

  if (messageType === 'location') {
    const location = payload['location'];
    if (isRecord(location)) {
      const lat = asNumber(location['latitude']);
      const lng = asNumber(location['longitude']);
      if (lat !== undefined && lng !== undefined) {
        meta['location'] = {
          latitude: lat,
          longitude: lng,
          ...(asString(location['name']) !== undefined ? { name: asString(location['name']) } : {}),
          ...(asString(location['address']) !== undefined
            ? { address: asString(location['address']) }
            : {}),
        };
      }
    }
  }

  const notifyName = asString(payload['notifyName']);
  if (notifyName !== undefined) meta['contactName'] = notifyName;

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Constrói o evento de uma mensagem inbound WAHA. */
function parseMessage(payload: JsonRecord): InboundEvent | undefined {
  const externalId = asString(payload['id']);
  const from = asString(payload['from']);
  if (externalId === undefined || from === undefined) return undefined;

  // WAHA emite eventos do próprio número (`fromMe: true`) — não são inbound.
  if (payload['fromMe'] === true) return undefined;

  const rawType = resolveRawType(payload);
  const messageType = mapMessageType(rawType);
  const content = extractContent(payload);
  const mediaRef = extractMediaRef(payload);
  const metadata = extractMetadata(payload, messageType);

  return {
    type: 'message',
    provider: PROVIDER,
    contactRemoteId: from,
    externalId,
    messageType,
    ...(content !== undefined && content.length > 0 ? { content } : {}),
    ...(mediaRef !== undefined ? { mediaRef } : {}),
    rawTimestamp: toIso(payload['timestamp']),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/** Mapeia o ack numérico WAHA para o status canônico. */
function mapAck(ack: number | undefined, ackName: string | undefined): 'sent' | 'delivered' | 'read' | 'failed' | undefined {
  // ackName tem prioridade quando presente (ex.: 'SERVER', 'DEVICE', 'READ').
  switch (ackName) {
    case 'ERROR':
      return 'failed';
    case 'SERVER':
      return 'sent';
    case 'DEVICE':
      return 'delivered';
    case 'READ':
    case 'PLAYED':
      return 'read';
    default:
      break;
  }
  switch (ack) {
    case -1:
      return 'failed';
    case 1:
      return 'sent';
    case 2:
      return 'delivered';
    case 3:
    case 4:
      return 'read';
    default:
      return undefined;
  }
}

/** Constrói o evento de status (ack) WAHA. */
function parseAck(payload: JsonRecord): InboundEvent | undefined {
  const externalId = asString(payload['id']);
  const status = mapAck(asNumber(payload['ack']), asString(payload['ackName']));
  if (externalId === undefined || status === undefined) return undefined;
  return {
    type: 'status',
    provider: PROVIDER,
    externalId,
    status,
    rawTimestamp: toIso(payload['timestamp']),
  };
}

/**
 * Parseia o envelope do webhook WAHA num array de `InboundEvent`. Roteia por
 * `event`: mensagens (`message`/`message.any`) e acks (`message.ack`).
 */
export function parseWahaWebhook(payload: unknown): InboundEvent[] {
  if (!isRecord(payload)) return [];

  const event = asString(payload['event']);
  const body = payload['payload'];
  if (!isRecord(body)) return [];

  const events: InboundEvent[] = [];

  switch (event) {
    case 'message':
    case 'message.any': {
      const ev = parseMessage(body);
      if (ev !== undefined) events.push(ev);
      break;
    }
    case 'message.ack': {
      const ev = parseAck(body);
      if (ev !== undefined) events.push(ev);
      break;
    }
    default:
      // Eventos não suportados (session.status, group.*, etc.) são ignorados.
      break;
  }

  return events;
}
