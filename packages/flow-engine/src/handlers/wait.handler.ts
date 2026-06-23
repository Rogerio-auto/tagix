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
    // Marcador por-node com o deadline: na 1ª entrada agenda o WAITING; quando o scheduler
    // re-enfileira (timer vencido), a 2ª entrada vê o deadline atingido e SEGUE (SUCCESS),
    // limpando o marcador. Sem isto o node re-esperava a cada re-entrega — loop infinito.
    const markerKey = `_wait_until_${node.id}`;
    const existing = ctx.variables[markerKey];
    const nowMs = ctx.now().getTime();

    if (typeof existing === 'number') {
      if (nowMs >= existing) {
        return { status: 'SUCCESS', variables: { [markerKey]: null } };
      }
      return { status: 'WAITING', nextStepAt: new Date(existing).toISOString() };
    }

    const ms = (data.minutes ?? 0) * 60_000 + (data.seconds ?? 0) * 1000;
    const until = nowMs + ms;
    return {
      status: 'WAITING',
      nextStepAt: new Date(until).toISOString(),
      variables: { [markerKey]: until },
    };
  },
};
