/**
 * Job de mídia inbound (F1-S10) — shape e parsing Zod.
 *
 * Espelha **exatamente** o que o worker inbound (`MqMediaEnqueue`, F1-S04)
 * publica no exchange de eventos com RK `hm.q.media.inbound` → cai na fila
 * canônica `hm.q.media`:
 *
 * ```
 * { provider, externalId, mediaRef: { refOrUrl, mimeType?, sha256?, fileName? }, routing }
 * ```
 *
 * `conversationId`/`messageId` ainda NÃO existem aqui — a correlação é por
 * `externalId` da mensagem dentro do canal resolvido pelas `routing` hints. O
 * media-worker baixa do provider, sobe pro storage e atualiza a linha da
 * mensagem (`messages.media_*`) casando pela `externalId`.
 *
 * `safeParse` no boundary do consumer: payload malformado é descartado (ack),
 * não reprocessado — um envelope imutável inválido nunca vai melhorar.
 */
import { z } from 'zod';
import { CHANNEL_PROVIDERS } from '@hm/shared';

/** `MediaRef` de `@hm/channels` validado em runtime (ref opaca ou URL temporária). */
const mediaRefSchema = z.object({
  refOrUrl: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sha256: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
});

/** Dicas de roteamento (espelham `RoutingHints` do inbound). */
const routingHintsSchema = z.object({
  phoneNumberId: z.string().min(1).optional(),
  igUserId: z.string().min(1).optional(),
  wahaSession: z.string().min(1).optional(),
});

/** Shape do `payload` do envelope `inbound.media.requested`. */
export const mediaJobSchema = z.object({
  provider: z.enum(CHANNEL_PROVIDERS),
  externalId: z.string().min(1),
  mediaRef: mediaRefSchema,
  routing: routingHintsSchema,
});

export type MediaJob = z.infer<typeof mediaJobSchema>;
export type MediaJobRoutingHints = z.infer<typeof routingHintsSchema>;

/** Valida o payload do envelope; lança `ZodError` se inválido. */
export function parseMediaJob(payload: unknown): MediaJob {
  return mediaJobSchema.parse(payload);
}
