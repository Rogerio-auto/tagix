/**
 * Parser dos ECOS do Instagram Messaging (F70-S04).
 *
 * A Meta devolve no webhook `messaging[]` um item com `message.is_echo=true` para
 * toda mensagem que a conta profissional ENVIA — pelo app do Instagram, pela
 * caixa da Meta ou por um app via API. `parseInstagramWebhook` descarta esses
 * itens de propósito (eco não é mensagem recebida, e virar inbound seria o pior
 * erro possível). Este parser é o caminho paralelo que os aproveita: o eco vira a
 * mensagem humana do dono da conta, com a mesma semântica do eco do WhatsApp em
 * coexistência.
 *
 * Forma do item de eco (Instagram API / Messenger Platform):
 * ```
 * { sender:{ id:<conta> }, recipient:{ id:<IGSID do contato> }, timestamp:<ms>,
 *   message:{ mid, text?, attachments?, is_echo:true, app_id? } }
 * ```
 * Aqui o papel de `sender`/`recipient` é o inverso do inbound: quem envia é a
 * própria conta, o contato é o `recipient`.
 *
 * `appId` é exposto (não filtrado aqui) porque só quem consome sabe quais apps
 * são "nossos": o eco de uma mensagem que o próprio Leadium mandou pela API NÃO
 * é resposta humana e precisa ser descartado pelo consumidor.
 *
 * Narrowing por colchetes, sem `any`. Tolerante a shape: item malformado é
 * ignorado, nunca lança.
 */

import type { MediaRef } from '../../types';

/** Tipos de mensagem que um eco do IG pode materializar. */
export type InstagramEchoMessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

/** Eco normalizado de uma mensagem enviada pela conta profissional. */
export interface InstagramEchoEvent {
  readonly provider: 'meta_instagram';
  /** Conta de destino do webhook (`entry[].id`) — casa `channels.ig_user_id`. */
  readonly igUserId: string;
  /** IGSID do contato (o `recipient` do eco) — `remote_id` da conversa. */
  readonly contactRemoteId: string;
  /** `message.mid` — o mesmo id que o envio pela API devolve. Chave de dedup. */
  readonly externalId: string;
  readonly messageType: InstagramEchoMessageType;
  readonly content?: string;
  readonly mediaRef?: MediaRef;
  /** App que enviou (`message.app_id`), quando a Meta informa. */
  readonly appId?: string;
  /** Horário do provider em ISO-8601. */
  readonly rawTimestamp: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** `app_id` chega como número na maioria dos payloads; normaliza para string. */
function asId(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return asString(v);
}

function toIso(rawTs: unknown): string {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    return new Date(rawTs).toISOString();
  }
  const s = asString(rawTs);
  if (s !== undefined) {
    const ms = Number(s);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function attachmentType(type: string | undefined): InstagramEchoMessageType | undefined {
  switch (type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'file':
      return 'document';
    default:
      return undefined;
  }
}

/** Extrai os ecos de um webhook do Instagram. Ignora tudo que não for eco. */
export function parseInstagramEchoes(payload: unknown): InstagramEchoEvent[] {
  if (!isRecord(payload)) return [];
  const echoes: InstagramEchoEvent[] = [];

  for (const entryRaw of asArray(payload['entry'])) {
    if (!isRecord(entryRaw)) continue;
    const entryId = asId(entryRaw['id']);

    for (const mRaw of asArray(entryRaw['messaging'])) {
      if (!isRecord(mRaw)) continue;
      const echo = parseEchoItem(mRaw, entryId);
      if (echo !== undefined) echoes.push(echo);
    }
  }

  return echoes;
}

function parseEchoItem(m: JsonRecord, entryId: string | undefined): InstagramEchoEvent | undefined {
  const message = isRecord(m['message']) ? m['message'] : undefined;
  if (message === undefined) return undefined;
  if (message['is_echo'] !== true) return undefined;
  // Eco de exclusão (a conta apagou a mensagem) não é resposta nova.
  if (message['is_deleted'] === true) return undefined;

  const sender = isRecord(m['sender']) ? m['sender'] : undefined;
  const recipient = isRecord(m['recipient']) ? m['recipient'] : undefined;
  // `entry.id` é a conta que recebeu o webhook (mesma chave do roteamento
  // inbound); `sender.id` é o fallback — num eco, o remetente é a própria conta.
  const igUserId = entryId ?? (sender ? asId(sender['id']) : undefined);
  const contactRemoteId = recipient ? asId(recipient['id']) : undefined;
  const externalId = asString(message['mid']);
  if (igUserId === undefined || contactRemoteId === undefined || externalId === undefined) {
    return undefined;
  }

  const appId = asId(message['app_id']);
  const base = {
    provider: 'meta_instagram' as const,
    igUserId,
    contactRemoteId,
    externalId,
    rawTimestamp: toIso(m['timestamp']),
    ...(appId !== undefined ? { appId } : {}),
  };

  const text = asString(message['text']);

  for (const attRaw of asArray(message['attachments'])) {
    if (!isRecord(attRaw)) continue;
    const type = attachmentType(asString(attRaw['type']));
    if (type === undefined) continue;
    const attPayload = isRecord(attRaw['payload']) ? attRaw['payload'] : undefined;
    const url = attPayload ? asString(attPayload['url']) : undefined;
    return {
      ...base,
      messageType: type,
      ...(text !== undefined ? { content: text } : {}),
      ...(url !== undefined ? { mediaRef: { refOrUrl: url } } : {}),
    };
  }

  if (text !== undefined) {
    return { ...base, messageType: 'text', content: text };
  }

  // Eco sem texto nem anexo suportado (share, story_mention, sticker): sem
  // conteúdo materializável — ignorado, igual ao inbound faz com o desconhecido.
  return undefined;
}
