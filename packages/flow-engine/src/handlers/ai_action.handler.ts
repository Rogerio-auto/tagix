/**
 * Handler `ai_action` (FLOW_BUILDER.md secao 4.1). Controla o agente IA da conversa:
 * ACTIVATE (ai_mode=on + agent_id), DEACTIVATE (ai_mode=off), TRANSFER (troca agent_id).
 * Aplica via ctx.setConversationAi (DB sob RLS).
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
    } else {
      if (!data.agentId) {
        return { status: 'ERROR', error: `ai_action ${data.action} exige agentId` };
      }
      await ctx.setConversationAi({ aiMode: 'on', agentId: data.agentId });
    }

    ctx.log('info', `ai_action ${data.action} aplicado`, { action: data.action });
    return { status: 'SUCCESS' };
  },
};
