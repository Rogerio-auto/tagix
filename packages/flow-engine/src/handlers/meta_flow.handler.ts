/**
 * Handler `meta_flow` (FLOW_BUILDER.md secao 4.1). Dispara um WhatsApp Flow (Meta) para a
 * conversa. O envio concreto (montagem do interactive type=flow) e responsabilidade do
 * adapter do canal; aqui montamos o payload e publicamos via ctx.sendMessage. A resposta
 * do usuario volta depois como flow_submission (F4-S14).
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const metaFlowSchema = z.object({
  metaFlowId: z.string().min(1),
  ctaText: z.string().optional(),
  body: z.string().optional(),
  flowToken: z.string().optional(),
  screen: z.string().optional(),
  flowActionPayload: z.record(z.unknown()).optional(),
});

export const metaFlowHandler: FlowHandler<z.infer<typeof metaFlowSchema>> = {
  schema: metaFlowSchema,
  async execute(node, ctx) {
    const data = metaFlowSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'meta_flow handler exige conversationId' };
    }

    const payload: Record<string, unknown> = {
      kind: 'meta_flow',
      metaFlowId: data.metaFlowId,
      flowToken: data.flowToken ?? ctx.executionId,
      ...(data.ctaText ? { ctaText: data.ctaText } : {}),
      ...(data.body ? { body: interpolate(data.body, ctx.variables) } : {}),
      ...(data.screen ? { screen: data.screen } : {}),
      ...(data.flowActionPayload ? { flowActionPayload: data.flowActionPayload } : {}),
    };

    await ctx.sendMessage({
      conversationId: ctx.conversationId,
      interactivePayload: payload,
    });

    return { status: 'SUCCESS' };
  },
};
