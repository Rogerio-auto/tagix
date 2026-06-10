/**
 * Handler `wait` (FLOW_BUILDER.md secao 4.1). Espera N minutos (ou segundos) e retoma:
 * retorna WAITING com `nextStepAt = now + duracao`. O scheduler (F4-S03) re-enfileira
 * quando o timer vence.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const waitSchema = z
  .object({
    minutes: z.number().min(0).optional(),
    seconds: z.number().min(0).optional(),
  })
  .refine((d) => d.minutes !== undefined || d.seconds !== undefined, {
    message: 'wait exige minutes ou seconds',
  });

export const waitHandler: FlowHandler<z.infer<typeof waitSchema>> = {
  schema: waitSchema,
  async execute(node, ctx) {
    const data = waitSchema.parse(node.data);
    const ms = (data.minutes ?? 0) * 60_000 + (data.seconds ?? 0) * 1000;
    const nextStepAt = new Date(ctx.now().getTime() + ms).toISOString();
    return { status: 'WAITING', nextStepAt };
  },
};
