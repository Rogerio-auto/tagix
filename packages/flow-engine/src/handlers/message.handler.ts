/**
 * Handler `message` (FLOW_BUILDER.md secao 3.4/4.1). Envia mensagem outbound: texto
 * (interpolado), midia, audio/voz. Suporta `preAction` (typing/recording) antes do envio.
 * Publica via ctx.sendMessage/ctx.sendPresence — nunca toca infra direto.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const messageSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  preAction: z.enum(['typing', 'recording']).optional(),
  preActionDurationMs: z.number().min(0).max(600_000).optional(),
  audioMessageKind: z.enum(['voice', 'audio_file']).optional(),
});

export const messageHandler: FlowHandler<z.infer<typeof messageSchema>> = {
  schema: messageSchema,
  async execute(node, ctx) {
    const data = messageSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'message handler exige conversationId' };
    }

    if (data.preAction) {
      await ctx.sendPresence({
        conversationId: ctx.conversationId,
        presence: data.preAction,
        durationMs: data.preActionDurationMs ?? 1500,
      });
    }

    await ctx.sendMessage({
      conversationId: ctx.conversationId,
      text: data.text ? interpolate(data.text, ctx.variables) : undefined,
      mediaStorageKey: data.mediaUrl,
      mediaType: data.mediaType,
      audioMessageKind: data.audioMessageKind,
    });

    return { status: 'SUCCESS' };
  },
};
