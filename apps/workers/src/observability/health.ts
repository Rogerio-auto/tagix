/**
 * observability/health — registro de health probes + heartbeats de scheduler,
 * consumidos pelo `/healthz` do servidor de métricas (F56-S17; contrato honrado
 * por F56-S18: liveness/readiness na porta `WORKERS_METRICS_PORT`).
 *
 * Módulo PURO — sem `prom-client`/Sentry/AMQP — para ser importável de qualquer
 * worker (inclusive schedulers com suíte sob mock) sem side-effect pesado nem
 * risco de ciclo. As probes concretas (AMQP, frescor de scheduler) são
 * registradas pelo bootstrap; aqui fica só o registro + agregação.
 */

/** Resultado de uma checagem individual de saúde. */
export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly detail?: Record<string, unknown>;
}

/** Probe síncrona — devolve o estado atual sem I/O (lê snapshots em memória). */
export type HealthProbe = () => HealthCheckResult;

const probes = new Map<string, HealthProbe>();

/**
 * Registra uma probe nomeada. Devolve um deregistrador idempotente (para o
 * shutdown limpar o que registrou). Re-registrar o mesmo nome substitui.
 */
export function registerHealthProbe(name: string, probe: HealthProbe): () => void {
  probes.set(name, probe);
  return () => {
    if (probes.get(name) === probe) probes.delete(name);
  };
}

/** Remove todas as probes (shutdown / reset de teste). */
export function clearHealthProbes(): void {
  probes.clear();
}

/** Relatório agregado consumido pelo `/healthz`. */
export interface HealthReport {
  readonly status: 'ok' | 'unhealthy';
  readonly checks: Readonly<Record<string, HealthCheckResult>>;
}

/**
 * Agrega todas as probes registradas. `status` só é `ok` se TODAS forem healthy.
 * Uma probe que lança é tratada como unhealthy (nunca derruba o /healthz).
 */
export function getHealthReport(): HealthReport {
  const checks: Record<string, HealthCheckResult> = {};
  let healthy = true;
  for (const [name, probe] of probes) {
    let result: HealthCheckResult;
    try {
      result = probe();
    } catch (err: unknown) {
      result = {
        healthy: false,
        detail: { error: err instanceof Error ? err.message : String(err) },
      };
    }
    if (!result.healthy) healthy = false;
    checks[name] = result;
  }
  return { status: healthy ? 'ok' : 'unhealthy', checks };
}

// ---------------------------------------------------------------- heartbeats

const heartbeats = new Map<string, number>();

/** Marca que um scheduler acabou de rodar um tick (epoch ms). */
export function recordSchedulerHeartbeat(name: string, at: number = Date.now()): void {
  heartbeats.set(name, at);
}

/** Último heartbeat conhecido de um scheduler (epoch ms) ou `undefined`. */
export function getSchedulerHeartbeat(name: string): number | undefined {
  return heartbeats.get(name);
}

/** Limpa os heartbeats (shutdown / reset de teste). */
export function clearSchedulerHeartbeats(): void {
  heartbeats.clear();
}

/**
 * Constrói uma probe de FRESCOR: healthy enquanto o último heartbeat do
 * scheduler for mais novo que `maxAgeMs`. O bootstrap semeia o heartbeat no
 * boot, então um scheduler que NUNCA tica vira unhealthy após `maxAgeMs` (detecta
 * consumer/tick travado — INF-07). `maxAgeMs` deve ser folgado (múltiplo do
 * intervalo do tick) para não gerar falso-negativo em ticks longos.
 */
export function schedulerFreshnessProbe(
  name: string,
  maxAgeMs: number,
  now: () => number = Date.now,
): HealthProbe {
  return () => {
    const last = heartbeats.get(name);
    if (last === undefined) {
      return { healthy: true, detail: { scheduler: name, state: 'no-heartbeat-yet' } };
    }
    const ageMs = now() - last;
    return { healthy: ageMs <= maxAgeMs, detail: { scheduler: name, ageMs, maxAgeMs } };
  };
}
