---
id: F10-S01
title: Observability stack — OTLP metrics + Prometheus + Grafana + Sentry (server-side)
phase: F10
status: in-progress
priority: high
estimated_size: L
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S01
  - docs/ROADMAP.md#F10-S02
  - docs/INFRASTRUCTURE.md
claimed_at: 2026-06-12T13:55:33Z

---
# F10-S01 — Observability stack (server-side)

> **source_docs:** `docs/ROADMAP.md` F10-S01/S02; `docs/INFRASTRUCTURE.md`
> **blocks:** F10-S07 (security hardening reusa middlewares).

## Objetivo

Prontidão de produção em observabilidade **server-side**: expor métricas Prometheus (`/metrics`) na API e nos workers, ligar o exporter de **métricas** OTLP ao `startTelemetry()` que já existe em `packages/logger/src/otel.ts` (hoje só traces), subir o stack local (otel-collector + Prometheus + Grafana com dashboards provisionados) no docker-compose, e integrar **Sentry opt-in** (no-op sem DSN) em `@hm/api`, `@hm/workers` e `agent-runtime` (Python).

## Contexto

`otel.ts` já inicia traces quando `OTEL_EXPORTER_OTLP_ENDPOINT` está setado (opt-in). Falta métricas (RED/latência/throughput), o `/metrics` scrape-target, o stack de visualização e captura de exceções. **Não** cobre o cliente web (error tracking de browser fica como follow-up — evita colidir com slots de frontend).

## Escopo (faz)

- `packages/logger`: estende `otel.ts` com `MeterProvider`/`PeriodicExportingMetricReader` (OTLP metrics) + helper de instrumentação reutilizável; mantém opt-in.
- `apps/api/src/middlewares/metrics.ts` (novo): coletor prom-client (http_request_duration, contagem por rota/status) + handler do endpoint `/metrics`.
- `apps/api/src/observability/**` e `apps/workers/src/observability/**`: init de Sentry opt-in (DSN via env, no-op sem DSN) + registro de métricas de domínio (fila, jobs, retries).
- `apps/agent-runtime/app/observability/**`: Sentry opt-in + métricas Prometheus do runtime (FastAPI middleware / `prometheus_client`).
- `infra/observability/**` (novo): `prometheus.yml`, `otel-collector-config.yaml`, dashboards Grafana (`grafana/provisioning/**` + JSON dos painéis essenciais: API latency p50/p95/p99, error rate, fila de workers, agent-runtime).
- `infra/docker/docker-compose.dev.yml`: serviços `prometheus`, `grafana`, `otel-collector` (profiles/opt-in).

## Fora de escopo

- Wire em `app.ts`/`main.ts`/`server.ts` (o orchestrator monta no merge).
- Error tracking do **browser** (web) — follow-up.
- Edição de `.env.example` (documente as envs novas em Notas; o orchestrator consolida).

## Arquivos permitidos

- `packages/logger/**`
- `apps/api/src/middlewares/metrics.ts`
- `apps/api/src/observability/**`
- `apps/workers/src/observability/**`
- `apps/agent-runtime/app/observability/**`
- `infra/observability/**`
- `infra/docker/docker-compose.dev.yml`

## Arquivos proibidos

- `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/workers/src/main.ts`, `apps/workers/src/bootstrap/**`
- `.env.example`
- `apps/api/src/middlewares/security.ts`, `apps/api/src/middlewares/error.ts` (F10-S07)

## Contratos de entrada/saída

- Export de `packages/logger`: `startTelemetry()` agora também inicia métricas; novo `getMeter(name)`/helpers. `metricsHandler` exportado de `apps/api/.../metrics.ts` para o orchestrator montar em `GET /metrics`.
- Sentry init export: `initSentry()` por app, idempotente, no-op sem DSN.

## Definition of Done

- [ ] `/metrics` (prom-client) expõe histogramas/counters; OTLP metrics ligado e opt-in (no-op sem endpoint).
- [ ] `docker compose ... --profile observability up` sobe prometheus+grafana+otel-collector; dashboards aparecem provisionados.
- [ ] Sentry init opt-in em api/workers/agent-runtime (no-op sem DSN); nenhuma exceção quando DSN ausente.
- [ ] `pnpm typecheck` + `pnpm lint` + `ruff check` (agent-runtime) verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/logger test
```

## Notas

- Especialista: **backend-engineer**.
- Reusa o opt-in já estabelecido em `otel.ts` (nada liga sem env). Envs novas: `OTEL_EXPORTER_OTLP_ENDPOINT` (já existe), `SENTRY_DSN_API`/`SENTRY_DSN_WORKERS`/`SENTRY_DSN_AGENT_RUNTIME`, `OTEL_METRICS_EXPORT_INTERVAL_MS`. Documentar para o orchestrator pôr em `.env.example`.
- prom-client e @sentry/node são deps novas de `@hm/api`/`@hm/workers`; `sentry-sdk` + `prometheus-client` no `pyproject.toml`. Liste para o orchestrator wire (não edite root manifests fora do allowed).
