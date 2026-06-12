/**
 * Serializadores: inputs Highermind -> payload Instagram Messaging
 * (Graph POST /{ig-user-id}/messages). Cobre text, media (image/video/audio/
 * file), interactive (ig_quick_replies/ig_generic_template/ig_button_template)
 * e a escolha messaging_type RESPONSE vs MESSAGE_TAG (INSTAGRAM.md 5.2, 5.3, 6).
 *
 * O `recipient.id` e o IGSID do contato. Sem any (narrowing por colchetes).
 */

import type { SendMediaInput, SendTextInput, IgMessageTag } from '../../types';
import type { JsonBody } from '../../shared/graphClient';
import { IgInteractiveSerializeError } from './errors';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Aplica messaging_type + tag conforme presenca de MESSAGE_TAG (6). */
function withMessagingType(body: JsonBody, tag: IgMessageTag | undefined): JsonBody {
  if (tag === undefined) {
    return { ...body, messaging_type: 'RESPONSE' };
  }
  return { ...body, messaging_type: 'MESSAGE_TAG', tag };
}

/** text -> { recipient, message:{ text }, messaging_type }. */
export function serializeText(input: SendTextInput): JsonBody {
  const body: JsonBody = {
    recipient: { id: input.contactRemoteId },
    message: { text: input.text },
  };
  return withMessagingType(body, input.messageTag);
}

/** IG so tem image|video|audio|file (sem voice/sticker/document distintos). */
function mapMediaKindToIg(kind: SendMediaInput['mediaKind']): 'image' | 'video' | 'audio' | 'file' {
  switch (kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
    case 'voice':
      return 'audio';
    default:
      return 'file';
  }
}

/** media -> attachment com url publica (Meta busca o binario). */
export function serializeMedia(input: SendMediaInput): JsonBody {
  const attachmentType = mapMediaKindToIg(input.mediaKind);
  const body: JsonBody = {
    recipient: { id: input.contactRemoteId },
    message: {
      attachment: {
        type: attachmentType,
        payload: { url: input.publicMediaUrl, is_reusable: false },
      },
    },
  };
  return withMessagingType(body, input.messageTag);
}

/**
 * interactive -> payload IG. Suporta ig_quick_replies, ig_generic_template e
 * ig_button_template (INSTAGRAM.md 9). Outros tipos (WA buttons/list) lancam
 * IgInteractiveSerializeError para o adapter mapear como erro tipado.
 */
export function serializeInteractive(
  payload: unknown,
  contactRemoteId: string,
  tag: IgMessageTag | undefined,
): JsonBody {
  if (!isRecord(payload)) {
    throw new IgInteractiveSerializeError('Payload interativo deve ser um objeto.');
  }
  const kind = asString(payload['type']);
  let message: JsonBody;
  switch (kind) {
    case 'ig_quick_replies':
      message = serializeQuickReplies(payload);
      break;
    case 'ig_generic_template':
      message = { attachment: serializeGenericTemplate(payload) };
      break;
    case 'ig_button_template':
      message = { attachment: serializeButtonTemplate(payload) };
      break;
    default:
      throw new IgInteractiveSerializeError(
        'Tipo interativo nao suportado no Instagram: ' + (kind ?? 'undefined') + '.',
      );
  }
  const body: JsonBody = { recipient: { id: contactRemoteId }, message };
  return withMessagingType(body, tag);
}

function serializeQuickReplies(payload: JsonRecord): JsonBody {
  const text = asString(payload['text']);
  if (text === undefined) {
    throw new IgInteractiveSerializeError('quick_replies exige `text`.');
  }
  const rawOptions = Array.isArray(payload['options']) ? payload['options'] : [];
  const quickReplies = rawOptions
    .filter(isRecord)
    .map((o): JsonRecord | undefined => {
      const title = asString(o['title']);
      const pl = asString(o['payload']);
      if (title === undefined || pl === undefined) return undefined;
      const imageUrl = asString(o['image_url']);
      return {
        content_type: 'text',
        title,
        payload: pl,
        ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
      };
    })
    .filter((o): o is JsonRecord => o !== undefined);
  if (quickReplies.length === 0) {
    throw new IgInteractiveSerializeError('quick_replies exige ao menos 1 opcao valida.');
  }
  return { text, quick_replies: quickReplies };
}

function serializeButton(b: JsonRecord): JsonRecord | undefined {
  const type = asString(b['type']);
  const title = asString(b['title']);
  if (title === undefined) return undefined;
  if (type === 'web_url') {
    const url = asString(b['url']);
    if (url === undefined) return undefined;
    return { type: 'web_url', title, url };
  }
  const pl = asString(b['payload']);
  if (pl === undefined) return undefined;
  return { type: 'postback', title, payload: pl };
}

function serializeGenericTemplate(payload: JsonRecord): JsonBody {
  const rawElements = Array.isArray(payload['elements']) ? payload['elements'] : [];
  const elements = rawElements
    .filter(isRecord)
    .map((el): JsonRecord | undefined => {
      const title = asString(el['title']);
      if (title === undefined) return undefined;
      const subtitle = asString(el['subtitle']);
      const imageUrl = asString(el['image_url']);
      const rawButtons = Array.isArray(el['buttons']) ? el['buttons'] : [];
      const buttons = rawButtons
        .filter(isRecord)
        .map(serializeButton)
        .filter((b): b is JsonRecord => b !== undefined);
      return {
        title,
        ...(subtitle !== undefined ? { subtitle } : {}),
        ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
        ...(buttons.length > 0 ? { buttons } : {}),
      };
    })
    .filter((e): e is JsonRecord => e !== undefined);
  if (elements.length === 0) {
    throw new IgInteractiveSerializeError('generic_template exige ao menos 1 elemento valido.');
  }
  return { type: 'template', payload: { template_type: 'generic', elements } };
}

function serializeButtonTemplate(payload: JsonRecord): JsonBody {
  const text = asString(payload['text']);
  if (text === undefined) {
    throw new IgInteractiveSerializeError('button_template exige `text`.');
  }
  const rawButtons = Array.isArray(payload['buttons']) ? payload['buttons'] : [];
  const buttons = rawButtons
    .filter(isRecord)
    .map(serializeButton)
    .filter((b): b is JsonRecord => b !== undefined);
  if (buttons.length === 0) {
    throw new IgInteractiveSerializeError('button_template exige ao menos 1 botao valido.');
  }
  return { type: 'template', payload: { template_type: 'button', text, buttons } };
}
