/**
 * Limites das consultas de CRM do Copiloto (F73-S06; COPILOTO.md P5, R5).
 *
 * Três tetos, todos aqui para que nenhuma ferramenta invente o seu:
 * - no máximo `READ_MAX_ROWS` (50) linhas por resultado (o mesmo teto do contrato do cartão);
 * - `model_view` ≤ `MODEL_VIEW_MAX_BYTES` (24 KB) serializado, medido em bytes UTF-8 (o que o
 *   modelo de fato recebe), cortando linhas do fim e dizendo que cortou;
 * - `statement_timeout` de 5 s por consulta (`applyDashboardStatementTimeout`, por import:
 *   a mesma régua das cargas do dashboard, ~10x o p95 esperado com os índices existentes).
 *
 * O cartão público (`public_event`) e o `model_view` são cortados de forma independente: o
 * cartão leva até 50 linhas para a tela; o modelo leva só o que cabe nos 24 KB.
 */
import { sql } from 'drizzle-orm';
import type { DbTx } from '@hm/db';
import { TOOL_RESULT_MAX_ROWS } from '@hm/shared';
import { applyDashboardStatementTimeout } from '../../../services/dashboard/viewer-scope';

export const READ_MAX_ROWS = TOOL_RESULT_MAX_ROWS;
export const MODEL_VIEW_MAX_BYTES = 24 * 1024;

/**
 * Prepara a transação da chamada para uma consulta de leitura. Primeira instrução de toda
 * ferramenta:
 * - `statement_timeout` de 5 s (a régua do dashboard, por import);
 * - `jit = off`: o predicado de escopo do AGENT (`dealScope` ⊃ visibilidade da inbox) tem dezenas
 *   de subplanos; o custo estimado passa de `jit_above_cost` e o Postgres compila ~110 funções
 *   (medido em 50 mil negócios: 18 ms sem JIT, 380 a 820 ms com JIT, para a mesma consulta).
 *   Consulta curta e interativa nunca compensa a compilação. `SET LOCAL`: morre com a transação.
 */
export async function startRead(tx: DbTx): Promise<void> {
  await applyDashboardStatementTimeout(tx);
  await tx.execute(sql`set local jit = off`);
}

/** Tamanho serializado (bytes UTF-8) de um `model_view`. */
export function modelViewBytes(view: unknown): number {
  return Buffer.byteLength(JSON.stringify(view), 'utf8');
}

export interface FittedModelView {
  readonly view: Record<string, unknown>;
  /** Quantas linhas couberam. */
  readonly shown: number;
  /** Quantas ficaram de fora só por causa do teto de bytes. */
  readonly omitted: number;
}

/**
 * Monta o `model_view` com o maior prefixo de `rows` que cabe em `maxBytes`. `build` recebe as
 * linhas mostradas e quantas foram omitidas, e deve refletir `omitted` no próprio objeto
 * (campo `truncated`/`omitted`), porque o tamanho do aviso entra na conta.
 *
 * O tamanho cresce com o número de linhas, então a busca é binária: O(log n) montagens.
 */
export function fitModelView<T>(
  rows: readonly T[],
  build: (shown: readonly T[], omitted: number) => Record<string, unknown>,
  maxBytes: number = MODEL_VIEW_MAX_BYTES,
): FittedModelView {
  const make = (n: number): Record<string, unknown> => build(rows.slice(0, n), rows.length - n);
  const full = make(rows.length);
  if (modelViewBytes(full) <= maxBytes) return { view: full, shown: rows.length, omitted: 0 };
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (modelViewBytes(make(mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { view: make(lo), shown: lo, omitted: rows.length - lo };
}

/** `limit` pedido → inteiro entre 1 e `max`, com `fallback` quando ausente. */
export function clampLimit(
  requested: number | undefined,
  fallback: number,
  max: number = READ_MAX_ROWS,
): number {
  const value = requested ?? fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
