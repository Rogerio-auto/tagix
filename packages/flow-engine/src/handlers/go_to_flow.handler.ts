/**
 * Handler `go_to_flow` (ESPINHA — F31-S08). Encerra a execucao atual e transfere o contato
 * para outro flow publicado do workspace. STUB minimo type-safe; F31-S11 implementa a
 * transferencia real (encerrar execucao + enfileirar o flow alvo).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const goToFlowSchema = z.object({
  /** flow alvo (flows.id) para onde a execucao sera transferida. */
  flowId: z.string().optional(),
});

export const goToFlowHandler: FlowHandler<z.infer<typeof goToFlowSchema>> = {
  schema: goToFlowSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
