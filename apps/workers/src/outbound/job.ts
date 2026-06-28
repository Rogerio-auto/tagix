/**
 * `OutboundJob` — discriminated union dos jobs de envio (LIVECHAT.md §3.2).
 *
 * Tipado e validado com Zod no boundary de consumo (`hm.q.outbound`). O
 * `Envelope.payload` chega como `unknown`; `parseOutboundJob` é a única porta
 * de entrada — qualquer shape inválido falha rápido (nack sem requeue).
 *
 * `messageTag` (janela 24h Instagram) é aceito aqui mas a regra de quando
 * aplicá-lo é de F1-S17; este worker só o repassa ao adapter.
 */
import { z } from 'zod';
import {
  InteractivePayloadSchema,
  contactCardSchema,
  latitudeSchema,
  longitudeSchema,
  reactionEmojiSchema,
} from '@hm/shared';

/** Tag de mensagem IG fora da janela 24h (INSTAGRAM.md §6). */
export const igMessageTagSchema = z.enum([
  'HUMAN_AGENT',
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
]);

/** Tipos de mídia enviáveis (LIVECHAT.md §4). */
export const outboundMediaKindSchema = z.enum([
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
]);

/** Componente de template HSM (estrutura validada de fato no serializer WA). */
export const templateComponentSchema = z.object({
  type: z.enum(['header', 'body', 'button']),
  parameters: z.array(z.unknown()).optional(),
});

/**
 * `chatId` é o id do contato no provider (WA: phone; IG: igsid; WAHA: chatId).
 * `channelId` resolve o canal/credencial. `conversationId` é a chave de
 * ordenação FIFO e de roteamento de socket.
 */
const base = {
  channelId: z.string().min(1),
  conversationId: z.string().min(1),
  /** Id da mensagem já persistida em estado `pending` (para correlação/status). */
  messageId: z.string().min(1),
};

export const outboundJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    ...base,
    chatId: z.string().min(1),
    text: z.string().min(1),
    replyToExternalId: z.string().optional(),
    messageTag: igMessageTagSchema.optional(),
    /** Epoch-ms da ultima inbound do contato (janela 24h IG). Opcional. */
    lastInboundFromContactAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('media'),
    ...base,
    chatId: z.string().min(1),
    mediaKind: outboundMediaKindSchema,
    /** URL pública servível ao provider (Meta busca o binário). */
    publicMediaUrl: z.string().url(),
    mime: z.string().min(1),
    caption: z.string().optional(),
    replyToExternalId: z.string().optional(),
    messageTag: igMessageTagSchema.optional(),
    lastInboundFromContactAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('template'),
    ...base,
    chatId: z.string().min(1),
    templateName: z.string().min(1),
    languageCode: z.string().min(1),
    components: z.array(templateComponentSchema),
  }),
  z.object({
    kind: z.literal('interactive'),
    ...base,
    chatId: z.string().min(1),
    payload: InteractivePayloadSchema,
    messageTag: igMessageTagSchema.optional(),
    lastInboundFromContactAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('location'),
    ...base,
    chatId: z.string().min(1),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    replyToExternalId: z.string().optional(),
    messageTag: igMessageTagSchema.optional(),
    lastInboundFromContactAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('contacts'),
    ...base,
    chatId: z.string().min(1),
    contacts: z.array(contactCardSchema).min(1),
    replyToExternalId: z.string().optional(),
    messageTag: igMessageTagSchema.optional(),
    lastInboundFromContactAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('reaction'),
    ...base,
    chatId: z.string().min(1),
    /** `external_id` (id do provider) da mensagem-alvo, resolvido na borda HTTP. */
    targetExternalId: z.string().min(1),
    /** `''` remove a reação. */
    emoji: reactionEmojiSchema,
  }),
  z.object({
    kind: z.literal('ig_private_reply'),
    ...base,
    /** IGSID alvo (recipient.id) — opcional; o adapter usa commentId. */
    chatId: z.string().optional(),
    commentId: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('ig_public_reply'),
    ...base,
    commentId: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('ig_hide_comment'),
    ...base,
    commentId: z.string().min(1),
    /** true = ocultar (default); false = reexibir. */
    hide: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('typing_indicator'),
    ...base,
    chatId: z.string().min(1),
    /** `externalId` da última inbound — alvo do indicador de presença. */
    targetExternalId: z.string().min(1),
    presence: z.enum(['typing', 'recording']),
  }),
]);

export type OutboundJob = z.infer<typeof outboundJobSchema>;
export type OutboundJobKind = OutboundJob['kind'];
export type IgMessageTag = z.infer<typeof igMessageTagSchema>;

/** Valida o payload bruto do envelope. Lança `ZodError` em shape inválido. */
export function parseOutboundJob(payload: unknown): OutboundJob {
  return outboundJobSchema.parse(payload);
}
