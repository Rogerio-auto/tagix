/**
 * Handler `ab_split` (ESPINHA — F31-S08). Distribui execucoes por variantes ponderadas,
 * seguindo pela edge nomeada da variante sorteada (`a`/`b`/...). STUB minimo type-safe;
 * F31-S11 implementa o sorteio ponderado deterministico e o `edgeHandle` real.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const abSplitSchema = z.object({
  /** variantes do teste; `key` casa com o sourceHandle da edge, `weight` e o peso relativo. */
  variants: z
    .array(
      z.object({
        key: z.string(),
        weight: z.number().nonnegative(),
      }),
    )
    .optional(),
});

export const abSplitHandler: FlowHandler<z.infer<typeof abSplitSchema>> = {
  schema: abSplitSchema,
  async execute(_node, _ctx) {
    return { status: 'SUCCESS' };
  },
};
