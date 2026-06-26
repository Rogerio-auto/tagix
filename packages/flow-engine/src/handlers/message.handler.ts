/**
 * Handler `message` (FLOW_BUILDER.md secao 3.4/4.1). Envia mensagem outbound rica:
 * texto (interpolado), midia (imagem/video/documento com legenda interpolada) e
 * audio — nota de voz (`audioMessageKind='voice'`) vs arquivo encaminhado
 * (`audioMessageKind='audio_file'`). Suporta `preAction` (typing/recording) antes
 * do envio. Publica via ctx.sendMessage/ctx.sendPresence — nunca toca infra direto.
 *
 * DOIS atrasos, com naturezas distintas:
 *   - `delayMs` — espera NÃO-BLOQUEANTE antes de enviar (espaça mensagens do flow). Implementada
 *     como o node `wait`: retorna WAITING com `nextStepAt`; o scheduler re-enfileira ao vencer.
 *     Não segura o flow-worker e não tem teto de 30s.
 *   - `preAction` + `preActionDurationMs` — indicador cosmético (digitando/gravando) mostrado
 *     LOGO ANTES do envio, com `ctx.sleep` curto e clampado em `MESSAGE_PRE_ACTION_MAX_MS` (o
 *     indicador do WhatsApp expira ~25s; sleeps longos bloqueariam o prefetch do worker).
 *
 * Retrocompat: `mediaUrl` (key crua dos flows antigos) ainda e aceito como `mediaStorageKey`.
 * Flows legados que setaram `preActionDurationMs` acima do teto (ex.: 88s) tinham o excedente
 * silenciosamente truncado; agora esse excedente vira `delayMs` em runtime (sem migração de dados),
 * honrando a espera total pretendida. Todos os campos novos sao opcionais.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler, FlowHandlerResult, FlowOutboundMediaKind } from '../types';

/** Teto da pré-ação (digitando/gravando). O indicador do WhatsApp expira ~25s. */
export const MESSAGE_PRE_ACTION_MAX_MS = 30_000;
/** Teto sano do delay de envio não-bloqueante (24h). Esperas maiores → use o node `wait`. */
export const MESSAGE_DELAY_MAX_MS = 24 * 60 * 60 * 1000;

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
  /** Espera NÃO-BLOQUEANTE (ms) antes de enviar — WAITING + scheduler, sem segurar o worker. */
  delayMs: z.number().min(0).max(MESSAGE_DELAY_MAX_MS).optional(),
  /** Audio: nota de voz (`voice`) vs arquivo de audio encaminhado (`audio_file`). */
  audioMessageKind: z.enum(['voice', 'audio_file']).optional(),
});

/** Delay efetivo (ms): `delayMs` explícito; senão o excedente legado de `preActionDurationMs`. */
function resolveDelayMs(data: z.infer<typeof messageSchema>): number {
  if (typeof data.delayMs === 'number' && data.delayMs > 0) {
    return Math.min(data.delayMs, MESSAGE_DELAY_MAX_MS);
  }
  const dur = data.preActionDurationMs ?? 0;
  if (dur > MESSAGE_PRE_ACTION_MAX_MS) {
    return Math.min(dur - MESSAGE_PRE_ACTION_MAX_MS, MESSAGE_DELAY_MAX_MS);
  }
  return 0;
}

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

    // ── Fase 1: delay de envio NÃO-BLOQUEANTE (WAITING + scheduler) ──
    // Espelha o node `wait`: marcador por-node guarda o deadline. 1ª entrada agenda WAITING;
    // re-entrega (timer vencido) limpa o marcador e segue para o envio. Idempotente: re-entrega
    // ANTES do vencimento re-agenda no MESMO deadline (não duplica o envio).
    const delayMarker = `_msg_delay_until_${node.id}`;
    const pendingUntil = ctx.variables[delayMarker];
    const cleanupMarker = typeof pendingUntil === 'number';
    if (typeof pendingUntil === 'number') {
      if (ctx.now().getTime() < pendingUntil) {
        return { status: 'WAITING', nextStepAt: new Date(pendingUntil).toISOString() };
      }
      // vencido: segue para o envio; o marcador é limpo no SUCCESS final.
    } else {
      const delayMs = resolveDelayMs(data);
      if (delayMs > 0) {
        const until = ctx.now().getTime() + delayMs;
        return {
          status: 'WAITING',
          nextStepAt: new Date(until).toISOString(),
          variables: { [delayMarker]: until },
        };
      }
    }

    // ── Fase 2: pré-ação (indicador, ≤30s) + envio ──
    // Pré-ação (digitando/gravando): mostra o indicador E espera de fato a duração antes
    // de enviar — assim a mensagem parece estar sendo digitada/gravada na hora. Teto de 30s:
    // o indicador do WhatsApp expira ~25s e evita segurar o worker (pausas longas = `delayMs`).
    if (data.preAction) {
      const ms = Math.min(Math.max(data.preActionDurationMs ?? 1500, 0), MESSAGE_PRE_ACTION_MAX_MS);
      await ctx.sendPresence({
        conversationId: ctx.conversationId,
        presence: data.preAction,
        durationMs: ms,
      });
      if (ms > 0) await ctx.sleep(ms);
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

    // Limpa o marcador quando havia delay (re-entrada vencida) — evita re-WAITING numa
    // re-entrega tardia do mesmo step após o envio.
    const result: FlowHandlerResult = cleanupMarker
      ? { status: 'SUCCESS', variables: { [delayMarker]: null } }
      : { status: 'SUCCESS' };
    return result;
  },
};
