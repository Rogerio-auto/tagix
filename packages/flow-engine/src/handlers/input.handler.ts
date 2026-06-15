/**
 * Handler `input` (ESPINHA — F31-S08). Captura a proxima resposta do contato e a grava
 * numa variavel (`input.*`), com timeout opcional (edges `response`/`timeout`). STUB minimo
 * type-safe; F31-S09 implementa o ciclo WAITING -> resolucao real.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const inputSchema = z.object({
  /** variavel onde a resposta sera gravada (sem o prefixo `input.`). */
  variable: z.string().optional(),
  /** mensagem de prompt enviada antes de aguardar (interpolada no handler real). */
  prompt: z.string().optional(),
  /** timeout em segundos antes de seguir pela edge `timeout`. */
  timeoutSeconds: z.number().int().positive().optional(),
});

export const inputHandler: FlowHandler<z.infer<typeof inputSchema>> = {
  schema: inputSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
