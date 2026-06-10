/**
 * Handler `switch` (FLOW_BUILDER.md secao 4.1). Roteia por uma variavel para uma das edges
 * dinamicas: o `edgeHandle` retornado e o proprio valor casado (a edge tem sourceHandle =
 * case). Quando nenhum case casa, segue pela edge `default`.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const switchSchema = z.object({
  variable: z.string().min(1),
  cases: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
});

export const switchHandler: FlowHandler<z.infer<typeof switchSchema>> = {
  schema: switchSchema,
  async execute(node, ctx) {
    const data = switchSchema.parse(node.data);
    const raw = data.variable.split('.').reduce<unknown>((obj, key) => {
      if (obj && typeof obj === 'object' && key in obj)
        return (obj as Record<string, unknown>)[key];
      return undefined;
    }, ctx.variables);

    const value = raw === undefined || raw === null ? '' : String(raw);
    const norm = (s: string) => (data.caseSensitive ? s : s.toLowerCase());
    const matched = (data.cases ?? []).find((c) => norm(c) === norm(value));

    return { status: 'SUCCESS', edgeHandle: matched ?? 'default' };
  },
};
