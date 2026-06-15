/**
 * Handler `assign` (ESPINHA — F31-S08). Atribui a conversa a um membro do workspace
 * (direto ou por estrategia, ex.: round-robin). STUB minimo type-safe; F31-S10 implementa
 * a atribuicao real sob RLS.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const assignSchema = z.object({
  /** membro alvo da atribuicao (workspace_members.id). */
  assigneeId: z.string().optional(),
  /** estrategia de atribuicao quando sem alvo fixo. */
  strategy: z.enum(['direct', 'round_robin']).optional(),
});

export const assignHandler: FlowHandler<z.infer<typeof assignSchema>> = {
  schema: assignSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
