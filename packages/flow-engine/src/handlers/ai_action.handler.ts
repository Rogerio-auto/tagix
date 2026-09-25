/**
 * Handler `ai_action` (FLOW_BUILDER.md secao 4.1). Controla o agente IA da conversa:
 * ACTIVATE (ai_mode=on + agent_id), DEACTIVATE (ai_mode=off), TRANSFER (troca agent_id).
 * Aplica via ctx.setConversationAi (DB sob RLS).
 *
 * F70-S07: ACTIVATE/TRANSFER ligam a IA e passam pela trava de origem do port — em
 * conversa sem origem comprovada a IA continua desligada e o handler registra a
 * recusa (log warn + variavel `ai_activation_blocked`), sem falhar o flow.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const aiActionSchema = z.object({
  action: z.enum(['ACTIVATE', 'DEACTIVATE', 'TRANSFER']),
  agentId: z.string().uuid().optional(),
});

export const aiActionHandler: FlowHandler<z.infer<typeof aiActionSchema>> = {
  schema: aiActionSchema,
  async execute(node, ctx) {
    const data = aiActionSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'ai_action handler exige conversationId' };
    }

    if (data.action === 'DEACTIVATE') {
      await ctx.setConversationAi({ aiMode: 'off', agentId: null });
      ctx.log('info', 'ai_action DEACTIVATE aplicado', { action: data.action });
      return { status: 'SUCCESS' };
    }

    if (!data.agentId) {
      return { status: 'ERROR', error: `ai_action ${data.action} exige agentId` };
    }
    const result = await ctx.setConversationAi({ aiMode: 'on', agentId: data.agentId });

    if (!result.applied) {
      // F70-S07 — recusa esperada, NAO erro: o flow segue. Conversa sem origem
      // comprovada (sem-origem/prospeccao, ou anterior a 0083) nunca recebe IA
      // automatica — o numero do dono e pessoal. A variavel deixa o flow ramificar
      // (ex.: avisar um humano) e fica registrada na execucao.
      ctx.log('warn', `ai_action ${data.action} recusado: ${result.reason}`, {
        action: data.action,
        reason: result.reason,
        conversationId: ctx.conversationId,
      });
      return { status: 'SUCCESS', variables: { ai_activation_blocked: result.reason } };
    }

    ctx.log('info', `ai_action ${data.action} aplicado`, { action: data.action });
    return { status: 'SUCCESS' };
  },
};
