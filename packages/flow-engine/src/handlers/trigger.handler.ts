/**
 * Handler `trigger` (FLOW_BUILDER.md secao 4.1). No inicial do grafo: nao tem efeito,
 * apenas marca o ponto de entrada e avanca para a proxima edge (SUCCESS).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const triggerSchema = z.object({}).passthrough();

export const triggerHandler: FlowHandler<z.infer<typeof triggerSchema>> = {
  schema: triggerSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
