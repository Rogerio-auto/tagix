/**
 * Handler `interactive` (FLOW_BUILDER.md secao 4.1). Envia interactive buttons/list. O
 * `body` e interpolado; o payload bruto (botoes/secoes) e repassado ao adapter do canal
 * via ctx.sendMessage.interactivePayload.
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const buttonSchema = z.object({ id: z.string(), title: z.string() });
const rowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
});
const sectionSchema = z.object({ title: z.string().optional(), rows: z.array(rowSchema) });

const interactiveSchema = z.object({
  kind: z.enum(['buttons', 'list']),
  body: z.string(),
  header: z.string().optional(),
  footer: z.string().optional(),
  buttons: z.array(buttonSchema).optional(),
  buttonLabel: z.string().optional(),
  sections: z.array(sectionSchema).optional(),
});

export const interactiveHandler: FlowHandler<z.infer<typeof interactiveSchema>> = {
  schema: interactiveSchema,
  async execute(node, ctx) {
    const data = interactiveSchema.parse(node.data);
    if (!ctx.conversationId) {
      return { status: 'ERROR', error: 'interactive handler exige conversationId' };
    }

    const payload: Record<string, unknown> = {
      kind: data.kind,
      body: interpolate(data.body, ctx.variables),
      ...(data.header ? { header: interpolate(data.header, ctx.variables) } : {}),
      ...(data.footer ? { footer: interpolate(data.footer, ctx.variables) } : {}),
      ...(data.buttons ? { buttons: data.buttons } : {}),
      ...(data.buttonLabel ? { buttonLabel: data.buttonLabel } : {}),
      ...(data.sections ? { sections: data.sections } : {}),
    };

    await ctx.sendMessage({
      conversationId: ctx.conversationId,
      interactivePayload: payload,
    });

    return { status: 'SUCCESS' };
  },
};
