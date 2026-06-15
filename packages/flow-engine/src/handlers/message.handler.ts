/**
 * Handler `message` (FLOW_BUILDER.md secao 3.4/4.1). Envia mensagem outbound rica:
 * texto (interpolado), midia (imagem/video/documento com legenda interpolada) e
 * audio — nota de voz (`audioMessageKind='voice'`) vs arquivo encaminhado
 * (`audioMessageKind='audio_file'`). Suporta `preAction` (typing/recording) antes
 * do envio. Publica via ctx.sendMessage/ctx.sendPresence — nunca toca infra direto.
 *
 * Retrocompat: `mediaUrl` (key crua dos flows antigos) ainda e aceito como
 * `mediaStorageKey`. Todos os campos novos sao opcionais.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler, FlowOutboundMediaKind } from '../types';

const messageSchema = z.object({
  /** Tipo selecionado no inspector. Ausente => derivado (texto/midia por MIME). */
  messageType: z.enum(['text', 'image', 'video', 'document', 'audio']).optional(),
  text: z.string().optional(),
  /** Legenda da midia (imagem/video/documento), separada do texto. Interpolada. */
  caption: z.string().optional(),
  /** Storage key canonica da midia. */
  mediaStorageKey: z.string().optional(),
  /** Retrocompat: key crua dos flows antigos. */
  mediaUrl: z.string().optional(),
  /** MIME do objeto (ex.: `image/png`, `video/mp4`, `audio/ogg`, `application/pdf`). */
  mediaType: z.string().optional(),
  /** Tipo de midia explicito; se ausente o publisher deriva de MIME/audioMessageKind. */
  mediaKind: z.enum(['image', 'video', 'audio', 'voice', 'document', 'sticker']).optional(),
  preAction: z.enum(['typing', 'recording']).optional(),
  preActionDurationMs: z.number().min(0).max(600_000).optional(),
  /** Audio: nota de voz (`voice`) vs arquivo de audio encaminhado (`audio_file`). */
  audioMessageKind: z.enum(['voice', 'audio_file']).optional(),
});

/** Deriva o `mediaKind` explicito quando possivel (explicito > audio > undefined). */
function resolveMediaKind(
  data: z.infer<typeof messageSchema>,
): FlowOutboundMediaKind | undefined {
  if (data.mediaKind) return data.mediaKind;
  if (data.audioMessageKind === 'voice') return 'voice';
  if (data.audioMessageKind === 'audio_file') return 'audio';
  return undefined;
}

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

    const mediaStorageKey = data.mediaStorageKey ?? data.mediaUrl;

    await ctx.sendMessage({
      conversationId: ctx.conversationId,
      text: data.text ? interpolate(data.text, ctx.variables) : undefined,
      caption: data.caption ? interpolate(data.caption, ctx.variables) : undefined,
      mediaStorageKey,
      mediaType: data.mediaType,
      mediaKind: resolveMediaKind(data),
      audioMessageKind: data.audioMessageKind,
    });

    return { status: 'SUCCESS' };
  },
};
