import type { NextFunction, Request, Response } from 'express';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type Registry as PromRegistry,
} from 'prom-client';

/**
 * Métricas Prometheus da API (RED: Rate, Errors, Duration) via prom-client.
 *
 * O `metricsMiddleware` instrumenta cada request HTTP (latência + contagem por
 * rota/status); o `metricsHandler` expõe o snapshot em `GET /metrics` (texto no
 * formato de exposição Prometheus, scrapeado pelo Prometheus do stack de
 * observabilidade). Nada aqui depende de env: prom-client é puramente in-process
 * e barato; o opt-in do PIPELINE (OTLP → collector) é cuidado por `@hm/logger`.
 *
 * O orchestrator monta no app:
 *   app.use(metricsMiddleware);            // antes das rotas
 *   app.get('/metrics', metricsHandler);   // fora da auth (scrape interno)
 */

// Registry dedicado (não polui o `register` default global do prom-client).
const registry: PromRegistry = new Registry();
registry.setDefaultLabels({ service: 'hm-api' });

// process_*, nodejs_* (heap, event-loop lag, GC, handles) — visão de saúde do runtime.
collectDefaultMetrics({ register: registry });

/**
 * Buckets de latência (segundos) calibrados para uma API conversacional:
 * cobre desde respostas sub-10ms (cache) até chamadas lentas (~5s) sem inflar
 * a cardinalidade. Prometheus deriva p50/p95/p99 via `histogram_quantile`.
 */
const DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP em segundos, por método/rota/status.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [...DURATION_BUCKETS],
  registers: [registry],
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP, por método/rota/status.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

/**
 * Rótulo de rota estável (baixa cardinalidade). Usa o template registrado pelo
 * Express (`/contacts/:id`) em vez do path concreto (`/contacts/abc123`), para
 * não explodir as séries temporais. Fallback `unmatched` para 404 / sem rota.
 */
function routeLabel(req: Request): string {
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const routePath = req.route && typeof req.route.path === 'string' ? req.route.path : '';
  const combined = `${base}${routePath}`;
  return combined.length > 0 ? combined : 'unmatched';
}

/**
 * Middleware de instrumentação. Inicia o cronômetro e, no fim da resposta
 * (`res.on('finish')`, garantido mesmo em erro/abort), grava duração e contagem.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // O endpoint de scrape não se auto-instrumenta (evita ruído / auto-referência).
  if (req.path === '/metrics') {
    next();
    return;
  }

  const endTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status: String(res.statusCode),
    };
    endTimer(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

/** GET /metrics — snapshot Prometheus (text exposition format). */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}

/** Registry exposto para métricas de domínio (mesmo `/metrics`). Ver observability/. */
export function getMetricsRegistry(): PromRegistry {
  return registry;
}

export { Counter, Histogram, Gauge } from 'prom-client';
export type { Registry } from 'prom-client';
