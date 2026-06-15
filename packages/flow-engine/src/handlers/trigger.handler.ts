/**
 * Handler `trigger` (FLOW_BUILDER.md secao 4.1). No inicial do grafo: nao tem efeito,
 * apenas marca o ponto de entrada e avanca para a proxima edge (SUCCESS).
 *
 * O `node.data` do no inicial carrega o tipo de gatilho editavel e seu `trigger_config`
 * (F31-S07). O schema e LENIENT (passthrough): o no inicial nunca deve falhar validacao,
 * mesmo em flows antigos cujo `data` e `{}`. As colunas `flows.triggerType/triggerConfig`
 * permanecem a fonte de verdade lida pelo dispatcher inbound.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

/** Tipos de gatilho suportados (espelha `flows.triggerType`). */
export const TRIGGER_TYPES = [
  'manual',
  'keyword',
  'new_message',
  'new_lead',
  'stage_change',
  'tag_added',
  'system_event',
  'flow_submission',
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

const triggerSchema = z
  .object({
    triggerType: z.enum(TRIGGER_TYPES).optional(),
    triggerConfig: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const triggerHandler: FlowHandler<z.infer<typeof triggerSchema>> = {
  schema: triggerSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
