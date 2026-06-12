import { createServer, type Server } from 'node:http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { getMeter } from '@hm/logger';

/**
 * Métricas dos workers. Diferente da API, o processo de workers não tem servidor
 * HTTP — então este módulo:
 *   1. mantém um Registry prom-client com métricas de domínio (jobs, retries,
 *      profundidade de fila, latência de processamento);
 *   2. expõe um servidor HTTP MÍNIMO e **opt-in** em `/metrics`, ligado só
 *      quando `WORKERS_METRICS_PORT` está setado (no-op caso contrário);
 *   3. espelha os mesmos sinais no `Meter` OTel (opt-in via `@hm/logger`).
 *
 * O orchestrator chama `startMetricsServer()` no bootstrap e `stopMetricsServer()`
 * no shutdown gracioso.
 */
const registry = new Registry();
registry.setDefaultLabels({ service: 'hm-workers' });
collectDefaultMetrics({ register: registry });

const meter = getMeter('@hm/workers');

// --- Prometheus (scrape via /metrics) ---

const jobsProcessedTotal = new Counter({
  name: 'hm_worker_jobs_processed_total',
  help: 'Jobs processados por worker e resultado.',
  labelNames: ['worker', 'result'] as const,
  registers: [registry],
});

const jobRetriesTotal = new Counter({
  name: 'hm_worker_job_retries_total',
  help: 'Reentregas/retries de jobs por worker.',
  labelNames: ['worker'] as const,
  registers: [registry],
});

const jobProcessingDuration = new Histogram({
  name: 'hm_worker_job_duration_seconds',
  help: 'Duração de processamento de job, em segundos, por worker.',
  labelNames: ['worker'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

const queueDepth = new Gauge({
  name: 'hm_worker_queue_depth',
  help: 'Profundidade observada da fila por worker (jobs aguardando).',
  labelNames: ['queue'] as const,
  registers: [registry],
});

// --- OTel (opt-in) ---

const otelJobsProcessed = meter.createCounter('hm.worker.jobs_processed', {
  description: 'Jobs processados pelos workers.',
});
const otelJobRetries = meter.createCounter('hm.worker.job_retries', {
  description: 'Retries de jobs.',
});

type Result = 'ok' | 'error';

/** Registra um job concluído, com duração em segundos. */
export function recordJobProcessed(worker: string, result: Result, durationSeconds: number): void {
  jobsProcessedTotal.inc({ worker, result });
  if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    jobProcessingDuration.observe({ worker }, durationSeconds);
  }
  otelJobsProcessed.add(1, { worker, result });
}

/** Registra um retry/reentrega de job. */
export function recordJobRetry(worker: string): void {
  jobRetriesTotal.inc({ worker });
  otelJobRetries.add(1, { worker });
}

/** Atualiza a profundidade observada de uma fila. */
export function setQueueDepth(queue: string, depth: number): void {
  if (Number.isFinite(depth) && depth >= 0) {
    queueDepth.set({ queue }, depth);
  }
}

/** Registry exposto para instrumentação adicional, se necessário. */
export function getWorkersMetricsRegistry(): Registry {
  return registry;
}

// --- Servidor HTTP mínimo (opt-in) ---

let server: Server | null = null;

/**
 * Sobe um servidor HTTP mínimo que responde `GET /metrics`. Opt-in por
 * `WORKERS_METRICS_PORT`; sem a env, é no-op e devolve `false`. Idempotente.
 */
export function startMetricsServer(): boolean {
  const raw = process.env['WORKERS_METRICS_PORT'];
  if (!raw || server) return false;
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0) return false;

  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': registry.contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500);
          res.end('metrics_error');
        });
      return;
    }
    res.writeHead(404);
    res.end('not_found');
  });
  const host = process.env['WORKERS_METRICS_HOST'] ?? '0.0.0.0';
  server.listen(port, host);
  return true;
}

/** Encerra o servidor de métricas (shutdown gracioso). */
export async function stopMetricsServer(): Promise<void> {
  const current = server;
  if (!current) return;
  server = null;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}
