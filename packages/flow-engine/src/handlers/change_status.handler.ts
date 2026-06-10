/**
 * Handler `change_status` (FLOW_BUILDER.md secao 4.1). Muda o status da conversa
 * (open/pending/closed/resolved/snoozed) via ctx.setConversationStatus (DB sob RLS).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const changeStatusSchema = z.object({
  status: z.enum(['open', 'pending', 'closed', 'resolved', 'snoozed']),
});

export const changeStatusHandler: FlowHandler<z.infer<typeof changeStatusSchema>> = {
  schema: changeStatusSchema,
  async execute(node, ctx) {
    const data = changeStatusSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'change_status handler exige conversationId' };
    }
    await ctx.setConversationStatus(data.status);
    ctx.log('info', `status -> ${data.status}`, { status: data.status });
    return { status: 'SUCCESS' };
  },
};
