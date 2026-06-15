/**
 * Handler `ab_split` (F31-S11). Distribui execucoes por variantes ponderadas,
 * seguindo pela edge nomeada da variante sorteada.
 *
 * Algoritmo: sorteio proporcional (roulette wheel) sobre os pesos declarados.
 * Variante sem peso e ignorada (peso 0). Soma total zero -> cai na primeira
 * variante declarada (fallback seguro). Pesos nao precisam somar 100.
 *
 * Edges do catalogo: dinamicas por `key` de cada variante (defaults: `a`, `b`).
 *
 * Guard anti-estado: o sorteio e estateless (sem semente persistida) — cada
 * execucao e independente. A distribuicao esperada converge em volume grande;
 * nao ha garantia de equidade por execucao individual.
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const variantSchema = z.object({
  /** key da variante, deve casar com o sourceHandle da edge no canvas. */
  key: z.string().min(1),
  /** peso relativo (positivo). Pesos sao proporcionais, nao precisam somar 100. */
  weight: z.number().nonnegative().optional(),
});

const abSplitSchema = z.object({
  variants: z.array(variantSchema).optional(),
});

type AbSplitData = z.infer<typeof abSplitSchema>;

/**
 * Sorteia uma variante por peso proporcional.
 * Retorna a key sorteada ou a primeira key (fallback).
 */
function pickVariant(variants: z.infer<typeof variantSchema>[]): string {
  // Filtra variantes com peso positivo.
  const eligible = variants.filter((v) => (v.weight ?? 0) > 0);

  if (eligible.length === 0) {
    // Fallback: primeira variante declarada (ou 'a' hardcoded).
    return variants[0]?.key ?? 'a';
  }

  const total = eligible.reduce((sum, v) => sum + (v.weight ?? 0), 0);
  let cursor = Math.random() * total;

  for (const v of eligible) {
    cursor -= v.weight ?? 0;
    if (cursor <= 0) return v.key;
  }

  // Rounding fallback — deve ser raro.
  return eligible[eligible.length - 1]!.key;
}

export const abSplitHandler: FlowHandler<AbSplitData> = {
  schema: abSplitSchema,
  async execute(node, ctx) {
    const data = abSplitSchema.parse(node.data);
    const variants = data.variants ?? [];

    if (variants.length === 0) {
      ctx.log('warn', 'ab_split: nenhuma variante configurada; seguindo por edge padrao', {
        nodeType: 'ab_split',
      });
      return { status: 'SUCCESS', edgeHandle: 'a' };
    }

    const chosen = pickVariant(variants);
    ctx.log('info', 'ab_split: variante sorteada', { chosen });
    return { status: 'SUCCESS', edgeHandle: chosen };
  },
};
