/**
 * Serializadores: inputs Highermind → payload da WhatsApp Cloud API (Graph
 * `POST /{phone-number-id}/messages`).
 *
 * Cobre text, media (por tipo), template (HSM) e interactive (buttons/list).
 * O `contactRemoteId` vira o campo `to`. Os tipos de input vêm de `../../types`;
 * o payload interativo (`unknown`) é narrowed contra o shape de
 * `InteractivePayload` (LIVECHAT.md §4.1).
 */

import type {
  SendMediaInput,
  SendTemplateInput,
  SendTextInput,
  TemplateComponent,
} from '../../types';
import type { JsonBody } from '../../shared/graphClient';

/** Envelope-base de toda mensagem WA. */
function base(to: string): JsonBody {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to };
}

/** Anexa contexto de reply (`context.message_id`) se houver. */
function withContext(body: JsonBody, replyToExternalId?: string): JsonBody {
  if (replyToExternalId === undefined) return body;
  return { ...body, context: { message_id: replyToExternalId } };
}

/** text → `{ type:'text', text:{ body, preview_url } }`. */
export function serializeText(input: SendTextInput): JsonBody {
  const body: JsonBody = {
    ...base(input.contactRemoteId),
    type: 'text',
    text: { preview_url: true, body: input.text },
  };
  return withContext(body, input.replyToExternalId);
}

/**
 * media → `{ type:<kind>, <kind>:{ link, caption? } }`.
 *
 * `voice` mapeia para o objeto `audio` da Graph COM `voice: true` — é o que faz o
 * WhatsApp renderizar como nota de voz (PTT, com a onda, "gravada agora") em vez de um
 * arquivo de áudio comum. O flag só é honrado para `audio/ogg; codecs=opus` (garantido no
 * Content-Type da URL assinada); para outros formatos a Graph o ignora. O modo
 * `audio` (audio_file) NÃO leva o flag — vai como áudio comum (arquivo/encaminhado).
 * `sticker`/`audio` não aceitam caption.
 */
export function serializeMedia(input: SendMediaInput): JsonBody {
  const isVoice = input.mediaKind === 'voice';
  const waKind = isVoice ? 'audio' : input.mediaKind;
  const supportsCaption =
    waKind === 'image' || waKind === 'video' || waKind === 'document';

  const mediaObj: JsonBody = { link: input.publicMediaUrl };
  if (supportsCaption && input.caption !== undefined) {
    mediaObj['caption'] = input.caption;
  }
  if (isVoice) {
    mediaObj['voice'] = true;
  }

  const body: JsonBody = {
    ...base(input.contactRemoteId),
    type: waKind,
    [waKind]: mediaObj,
  };
  return withContext(body, input.replyToExternalId);
}

/** template (HSM) → `{ type:'template', template:{ name, language, components } }`. */
export function serializeTemplate(input: SendTemplateInput): JsonBody {
  const template: JsonBody = {
    name: input.templateName,
    language: { code: input.languageCode },
  };
  if (input.components.length > 0) {
    template['components'] = input.components.map(serializeTemplateComponent);
  }
  return {
    ...base(input.contactRemoteId),
    type: 'template',
    template,
  };
}

/** Componente de template → objeto Graph (`type` + `parameters?`). */
function serializeTemplateComponent(component: TemplateComponent): JsonBody {
  const out: JsonBody = { type: component.type };
  if (component.parameters !== undefined && component.parameters.length > 0) {
    out['parameters'] = [...component.parameters];
  }
  return out;
}

// --- Interactive ---

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Erro de serialização (payload interativo malformado). */
export class InteractiveSerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveSerializeError';
  }
}

/**
 * interactive → payload Graph. Suporta os tipos do `InteractivePayloadSchema`:
 * `buttons` (reply buttons), `list` (sections/rows). `template` aqui não é
 * interativo nativo — o caller deve usar `serializeTemplate`.
 */
export function serializeInteractive(payload: unknown, contactRemoteId: string): JsonBody {
  if (!isRecord(payload)) {
    throw new InteractiveSerializeError('Payload interativo deve ser um objeto.');
  }
  const kind = asString(payload['type']);
  switch (kind) {
    case 'buttons':
      return serializeButtons(payload, contactRemoteId);
    case 'list':
      return serializeList(payload, contactRemoteId);
    default:
      throw new InteractiveSerializeError(
        `Tipo interativo não suportado no WhatsApp: '${kind ?? 'undefined'}'.`,
      );
  }
}

/** buttons → interactive.type='button' com até 3 reply buttons. */
function serializeButtons(payload: JsonRecord, contactRemoteId: string): JsonBody {
  const body = asString(payload['body']);
  if (body === undefined) {
    throw new InteractiveSerializeError('Botões interativos exigem `body`.');
  }
  const rawButtons = Array.isArray(payload['buttons']) ? payload['buttons'] : [];
  const buttons = rawButtons
    .filter(isRecord)
    .map((b) => ({ id: asString(b['id']), title: asString(b['text']) }))
    .filter((b): b is { id: string; title: string } => b.id !== undefined && b.title !== undefined)
    .map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } }));

  if (buttons.length === 0) {
    throw new InteractiveSerializeError('Botões interativos exigem ao menos 1 botão válido.');
  }

  const interactive: JsonBody = {
    type: 'button',
    body: { text: body },
    action: { buttons },
  };
  applyHeaderFooter(interactive, payload);

  return {
    ...base(contactRemoteId),
    type: 'interactive',
    interactive,
  };
}

/** list → interactive.type='list' com sections/rows. */
function serializeList(payload: JsonRecord, contactRemoteId: string): JsonBody {
  const body = asString(payload['body']);
  const buttonText = asString(payload['button']);
  if (body === undefined || buttonText === undefined) {
    throw new InteractiveSerializeError('Lista interativa exige `body` e `button`.');
  }

  const rawSections = Array.isArray(payload['sections']) ? payload['sections'] : [];
  const sections = rawSections.filter(isRecord).map((section) => {
    const rawRows = Array.isArray(section['rows']) ? section['rows'] : [];
    const rows = rawRows
      .filter(isRecord)
      .map((r) => {
        const id = asString(r['id']);
        const title = asString(r['title']);
        const description = asString(r['description']);
        return id !== undefined && title !== undefined
          ? { id, title, ...(description !== undefined ? { description } : {}) }
          : undefined;
      })
      .filter((r): r is { id: string; title: string; description?: string } => r !== undefined);
    const title = asString(section['title']);
    return { ...(title !== undefined ? { title } : {}), rows };
  });

  if (sections.length === 0 || sections.every((s) => s.rows.length === 0)) {
    throw new InteractiveSerializeError('Lista interativa exige ao menos 1 row válida.');
  }

  const interactive: JsonBody = {
    type: 'list',
    body: { text: body },
    action: { button: buttonText, sections },
  };
  applyHeaderFooter(interactive, payload);

  return {
    ...base(contactRemoteId),
    type: 'interactive',
    interactive,
  };
}

/** Aplica header (texto) e footer opcionais ao objeto interactive. */
function applyHeaderFooter(interactive: JsonBody, payload: JsonRecord): void {
  const header = asString(payload['header']);
  if (header !== undefined) {
    interactive['header'] = { type: 'text', text: header };
  }
  const footer = asString(payload['footer']);
  if (footer !== undefined) {
    interactive['footer'] = { text: footer };
  }
}
