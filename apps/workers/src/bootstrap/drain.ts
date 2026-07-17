/**
 * bootstrap/drain — coordenador de encerramento gracioso (F56-S17, INF-10).
 *
 * Rastreia trabalho IN-FLIGHT (handlers de consumer que o bootstrap controla
 * diretamente) para que o shutdown possa AGUARDAR a conclusão antes de fechar as
 * conexões AMQP — evitando reentrega desnecessária de mensagens que já estavam
 * sendo processadas (a mensagem é ackada ANTES do close). Um deadline garante que
 * um handler travado não segure o shutdown para sempre.
 *
 * Módulo puro (sem AMQP/DB) — testável isoladamente.
 */

export interface DrainController {
  /** nº de operações in-flight agora. */
  readonly inFlight: number;
  /** `true` após `drain()` iniciar — handlers podem consultar para parar cedo. */
  readonly draining: boolean;
  /** Executa `fn` contabilizando-a como in-flight (o drain a aguarda). */
  track<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Marca como drenando e aguarda o in-flight chegar a 0 ou o deadline expirar.
   * Resolve `true` se drenou dentro do prazo, `false` se estourou o deadline.
   */
  drain(deadlineMs: number, pollMs?: number): Promise<boolean>;
}

export function createDrainController(): DrainController {
  let count = 0;
  let draining = false;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref?.();
    });

  return {
    get inFlight() {
      return count;
    },
    get draining() {
      return draining;
    },
    async track<T>(fn: () => Promise<T>): Promise<T> {
      count += 1;
      try {
        return await fn();
      } finally {
        count -= 1;
      }
    },
    async drain(deadlineMs: number, pollMs = 25): Promise<boolean> {
      draining = true;
      const start = Date.now();
      while (count > 0) {
        if (Date.now() - start >= deadlineMs) return false;
        await sleep(Math.min(pollMs, Math.max(1, deadlineMs - (Date.now() - start))));
      }
      return true;
    },
  };
}

const DEFAULT_DRAIN_DEADLINE_MS = 10_000;

/** Lê `WORKERS_DRAIN_DEADLINE_MS` (default 10s), com fallback seguro. */
export function drainDeadlineFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['WORKERS_DRAIN_DEADLINE_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_DRAIN_DEADLINE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRAIN_DEADLINE_MS;
}
