/**
 * Handler `wait_for_response` (FLOW_BUILDER.md secao 4.2 — maquina biestavel).
 *
 * 1a chamada: envia mensagem opcional (interpolada), seta markers e retorna WAITING com
 *   nextStepAt = now + timeoutMinutes. Edges: `response` e `timeout`.
 * Resumption: resumeFlowWithResponse (F4-S02) marca `responded`+`response_edge`; o handler
 *   ve `responded` -> limpa markers e retorna SUCCESS pela edge `response`.
 * Timeout: scheduler re-enfileira; handler ve waiting sem `responded` -> SUCCESS `timeout`.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const wfrSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  timeoutMinutes: z.number().min(0).optional(),
});

export const waitForResponseHandler: FlowHandler<z.infer<typeof wfrSchema>> = {
  schema: wfrSchema,
  async execute(node, ctx) {
    const data = wfrSchema.parse(node.data);
    const vars = ctx.variables;

    // Resumption: o usuario respondeu (marcado por resumeFlowWithResponse).
    if (vars['responded'] === true) {
      const edge =
        typeof vars['response_edge'] === 'string' ? (vars['response_edge'] as string) : 'response';
      return {
        status: 'SUCCESS',
        edgeHandle: edge === 'timeout' ? 'response' : edge,
        variables: {
          waiting_for_response: false,
          responded: false,
          response_edge: null,
        },
      };
    }

    // Timeout: ja estava aguardando e o timer venceu sem resposta.
    if (vars['waiting_for_response'] === true) {
      return {
        status: 'SUCCESS',
        edgeHandle: 'timeout',
        variables: { waiting_for_response: false },
      };
    }

    // 1a chamada: envia prompt opcional e entra em espera.
    if (ctx.conversationId && (data.text || data.mediaUrl)) {
      await ctx.sendMessage({
        conversationId: ctx.conversationId,
        text: data.text ? interpolate(data.text, vars) : undefined,
        mediaStorageKey: data.mediaUrl,
        mediaType: data.mediaType,
      });
    }

    const nextStepAt = new Date(
      ctx.now().getTime() + (data.timeoutMinutes ?? 60) * 60_000,
    ).toISOString();
    return {
      status: 'WAITING',
      nextStepAt,
      variables: {
        waiting_for_response: true,
        waiting_started_at: ctx.now().toISOString(),
      },
    };
  },
};
