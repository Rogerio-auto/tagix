/**
 * Motor do sweep de retenção (F56-S25, DB-02) — puro e injetável.
 *
 * A lógica de varredura é separada do acesso a banco por uma porta
 * (`RetentionSweepPort`): assim o algoritmo (horizonte, lotes, idempotência,
 * teto por tick) é testável com dados sintéticos, sem infra. A implementação
 * real contra o Postgres vive em `db-port.ts`.
 */

/**
 * Porta de escrita do sweep. A implementação apaga, num único lote, no máximo
 * `limit` linhas com `received_at` estritamente ANTERIOR a `cutoff`, e devolve
 * quantas removeu. `0` significa que não há mais nada abaixo do horizonte.
 *
 * Contrato de idempotência: chamar repetidamente após tudo purgado devolve `0`
 * (o predicado deixa de casar). O sweep nunca apaga o que está no horizonte.
 */
export interface RetentionSweepPort {
  deleteOlderThan(cutoff: Date, limit: number): Promise<number>;
}

/** Parâmetros de uma execução do sweep. */
export interface SweepOptions {
  /** Só linhas com `received_at < cutoff` são elegíveis. */
  readonly cutoff: Date;
  /** Tamanho do lote (LIMIT). Deve ser > 0. */
  readonly batchSize: number;
  /** Teto de lotes por execução (bound de trabalho por tick). Deve ser > 0. */
  readonly maxBatches: number;
}

/** Resultado agregado de uma execução do sweep. */
export interface SweepResult {
  /** Total de linhas removidas nesta execução. */
  readonly deleted: number;
  /** Quantos lotes foram executados. */
  readonly batches: number;
  /**
   * `true` se a execução parou por atingir `maxBatches` ainda havendo backlog —
   * o próximo tick continua de onde parou. `false` se drenou tudo abaixo do
   * horizonte (ou não havia nada a purgar).
   */
  readonly reachedCap: boolean;
}

/** Calcula o corte de retenção: `now - horizonMs`. */
export function computeCutoff(now: Date, horizonMs: number): Date {
  return new Date(now.getTime() - horizonMs);
}

/**
 * Executa o sweep em lotes até drenar tudo abaixo do horizonte ou atingir o teto
 * de lotes. Para assim que um lote volta com menos linhas que `batchSize` (não há
 * mais backlog) — evitando um DELETE extra que apagaria `0` linhas.
 */
export async function runSweep(
  port: RetentionSweepPort,
  opts: SweepOptions,
): Promise<SweepResult> {
  const batchSize = opts.batchSize > 0 ? opts.batchSize : 1;
  const maxBatches = opts.maxBatches > 0 ? opts.maxBatches : 1;

  let deleted = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const removed = await port.deleteOlderThan(opts.cutoff, batchSize);
    if (removed <= 0) {
      // Nada mais abaixo do horizonte → idempotente daqui em diante.
      return { deleted, batches, reachedCap: false };
    }
    deleted += removed;
    batches += 1;
    if (removed < batchSize) {
      // Lote parcial ⇒ o backlog acabou; não há motivo para outro DELETE.
      return { deleted, batches, reachedCap: false };
    }
  }

  // Saiu pelo teto: pode haver mais para o próximo tick.
  return { deleted, batches, reachedCap: true };
}
