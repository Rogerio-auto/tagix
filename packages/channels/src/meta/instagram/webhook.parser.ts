/**
 * Parser do webhook Instagram Messaging -> InboundEvent[] (INSTAGRAM.md 5.2).
 * Cobre DM (text/attachments), story_mention, story_reply, share, postback,
 * reaction, seen (read), referral e comments/mentions. Echoes/deletes ignorados.
 * Narrowing por colchetes, sem any.
 */

import type { InboundEvent, MediaRef } from '../../types';

const PROVIDER = 'meta_instagram' as const;

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

function asBool(v: unknown): boolean {
  return v === true;
}

function toIso(rawTs: unknown): string {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    return new Date(rawTs).toISOString();
  }
  const s = asString(rawTs);
  if (s !== undefined) {
    const ms = Number(s);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
    return s;
  }
  return new Date().toISOString();
}

function attachmentToMediaType(
  type: string | undefined,
): 'image' | 'video' | 'audio' | 'document' {
  switch (type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    default:
      return 'document';
  }
}

function attachmentMediaRef(att: JsonRecord): MediaRef | undefined {
  const payload = isRecord(att['payload']) ? att['payload'] : undefined;
  const url = payload ? asString(payload['url']) : undefined;
  if (url === undefined) return undefined;
  return { refOrUrl: url };
}

export function parseInstagramWebhook(payload: unknown): InboundEvent[] {
  if (!isRecord(payload)) return [];
  const events: InboundEvent[] = [];

  for (const entryRaw of asArray(payload['entry'])) {
    if (!isRecord(entryRaw)) continue;

    for (const mRaw of asArray(entryRaw['messaging'])) {
      if (!isRecord(mRaw)) continue;
      const ev = parseMessagingItem(mRaw);
      if (ev) events.push(ev);
    }

    for (const cRaw of asArray(entryRaw['changes'])) {
      if (!isRecord(cRaw)) continue;
      const field = asString(cRaw['field']);
      const value = isRecord(cRaw['value']) ? cRaw['value'] : undefined;
      if (value === undefined) continue;
      if (field === 'comments') {
        const ev = parseComment(value);
        if (ev) events.push(ev);
      } else if (field === 'mentions') {
        const ev = parseMention(value);
        if (ev) events.push(ev);
      }
    }
  }

  return events;
}

function parseMessagingItem(m: JsonRecord): InboundEvent | undefined {
  const sender = isRecord(m['sender']) ? m['sender'] : undefined;
  const contactRemoteId = sender ? asString(sender['id']) : undefined;
  const ts = toIso(m['timestamp']);

  const message = isRecord(m['message']) ? m['message'] : undefined;
  if (message) {
    if (asBool(message['is_echo']) || asBool(message['is_deleted'])) return undefined;
    if (contactRemoteId === undefined) return undefined;

    const externalId = asString(message['mid']) ?? '';
    const attachments = asArray(message['attachments']).filter(isRecord);

    const storyMention = attachments.find((a) => asString(a['type']) === 'story_mention');
    if (storyMention) {
      const mediaRef = attachmentMediaRef(storyMention);
      const payload = isRecord(storyMention['payload']) ? storyMention['payload'] : undefined;
      const storyId =
        (payload ? asString(payload['id']) : undefined) ??
        (payload ? asString(payload['story_id']) : undefined) ??
        externalId;
      if (mediaRef) {
        return {
          type: 'story_mention',
          provider: PROVIDER,
          contactRemoteId,
          externalId,
          mediaRef,
          storyId,
        };
      }
    }

    const replyTo = isRecord(message['reply_to']) ? message['reply_to'] : undefined;
    const story = replyTo && isRecord(replyTo['story']) ? replyTo['story'] : undefined;
    if (story) {
      const storyId = asString(story['id']) ?? externalId;
      const content = asString(message['text']) ?? '';
      return {
        type: 'story_reply',
        provider: PROVIDER,
        contactRemoteId,
        externalId,
        storyId,
        content,
      };
    }

    const share = attachments.find((a) => asString(a['type']) === 'share');
    if (share) {
      const mediaRef = attachmentMediaRef(share) ?? { refOrUrl: '' };
      return {
        type: 'share',
        provider: PROVIDER,
        contactRemoteId,
        externalId,
        mediaRef,
      };
    }

    const mediaAtt = attachments.find((a) => {
      const t = asString(a['type']);
      return t === 'image' || t === 'video' || t === 'audio' || t === 'file';
    });
    if (mediaAtt) {
      const mediaRef = attachmentMediaRef(mediaAtt);
      return {
        type: 'message',
        provider: PROVIDER,
        contactRemoteId,
        externalId,
        messageType: attachmentToMediaType(asString(mediaAtt['type'])),
        content: asString(message['text']),
        ...(mediaRef ? { mediaRef } : {}),
        rawTimestamp: ts,
      };
    }

    const text = asString(message['text']);
    if (text !== undefined) {
      return {
        type: 'message',
        provider: PROVIDER,
        contactRemoteId,
        externalId,
        messageType: 'text',
        content: text,
        rawTimestamp: ts,
      };
    }
    return undefined;
  }

  return parseNonMessageItem(m, contactRemoteId, ts);
}

function parseNonMessageItem(
  m: JsonRecord,
  contactRemoteId: string | undefined,
  ts: string,
): InboundEvent | undefined {
  const postback = isRecord(m['postback']) ? m['postback'] : undefined;
  if (postback && contactRemoteId !== undefined) {
    const payload = asString(postback['payload']) ?? '';
    const title = asString(postback['title']);
    const externalId = asString(postback['mid']) ?? 'pb_' + contactRemoteId + '_' + ts;
    return {
      type: 'postback',
      provider: PROVIDER,
      contactRemoteId,
      externalId,
      payload,
      ...(title !== undefined ? { title } : {}),
    };
  }

  const reaction = isRecord(m['reaction']) ? m['reaction'] : undefined;
  if (reaction && contactRemoteId !== undefined) {
    const emoji = asString(reaction['emoji']) ?? asString(reaction['reaction']) ?? '';
    const targetExternalId = asString(reaction['mid']) ?? '';
    return {
      type: 'reaction',
      provider: PROVIDER,
      contactRemoteId,
      targetExternalId,
      emoji,
    };
  }

  const read = isRecord(m['read']) ? m['read'] : undefined;
  if (read) {
    const externalId = asString(read['mid']) ?? '';
    return {
      type: 'status',
      provider: PROVIDER,
      externalId,
      status: 'read',
      rawTimestamp: ts,
    };
  }

  const referral = isRecord(m['referral']) ? m['referral'] : undefined;
  if (referral && contactRemoteId !== undefined) {
    const source = asString(referral['source']) ?? 'unknown';
    return {
      type: 'referral',
      provider: PROVIDER,
      contactRemoteId,
      source,
      referralData: referral,
    };
  }

  return undefined;
}

function parseComment(value: JsonRecord): InboundEvent | undefined {
  const commentId = asString(value['id']);
  if (commentId === undefined) return undefined;

  const from = isRecord(value['from']) ? value['from'] : undefined;
  const fromIgsId = (from ? asString(from['id']) : undefined) ?? '';
  const fromUsername = from ? asString(from['username']) : undefined;

  const media = isRecord(value['media']) ? value['media'] : undefined;
  const mediaId =
    (media ? asString(media['id']) : undefined) ?? asString(value['media_id']) ?? '';
  const mediaProductType = media ? asString(media['media_product_type']) : undefined;
  const mediaKind = mapMediaKind(mediaProductType);

  const parent = asString(value['parent_id']);
  const text = asString(value['text']);

  return {
    type: 'comment',
    provider: PROVIDER,
    mediaId,
    ...(mediaKind ? { mediaKind } : {}),
    commentId,
    ...(parent !== undefined ? { parentCommentId: parent } : {}),
    fromIgsId,
    ...(fromUsername !== undefined ? { fromUsername } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

function parseMention(value: JsonRecord): InboundEvent | undefined {
  const commentId = asString(value['comment_id']) ?? asString(value['id']);
  const mediaId = asString(value['media_id']) ?? '';
  if (commentId === undefined) return undefined;
  const from = isRecord(value['from']) ? value['from'] : undefined;
  const fromIgsId = (from ? asString(from['id']) : undefined) ?? '';
  const fromUsername = from ? asString(from['username']) : undefined;
  const text = asString(value['text']);
  return {
    type: 'comment',
    provider: PROVIDER,
    mediaId,
    commentId,
    fromIgsId,
    ...(fromUsername !== undefined ? { fromUsername } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

function mapMediaKind(
  productType: string | undefined,
): 'post' | 'reel' | 'story' | undefined {
  switch (productType) {
    case 'FEED':
    case 'AD':
      return 'post';
    case 'REELS':
      return 'reel';
    case 'STORY':
      return 'story';
    default:
      return undefined;
  }
}
