---
id: F0-S08
title: Logger Pino + OpenTelemetry + PII masking em @hm/logger
phase: F0
status: review
priority: high
estimated_size: S
depends_on: [F0-S01]
agent_id: backend-engineer
claimed_at: 2026-06-09T22:05:47Z
completed_at: 2026-06-09T22:08:00Z

---
# F0-S08 — Logger Pino + OTel + PII masking

> **source_docs:** `docs/ARCHITECTURE.md` §Logging/Observability; `docs/INFRASTRUCTURE.md`

## Objetivo

Trocar a implementação interna de `@hm/logger` (hoje console) por Pino estruturado com PII masking, e instrumentação OpenTelemetry pronta (exporter OTLP opcional via env), mantendo o contrato `Logger` atual.

## Escopo (faz)

- `packages/logger` — dep `pino`; `createLogger` usa Pino (level por env), `redact` de PII (authorization, password, token, phone, email configuráveis). Mantém interface `Logger`/`child`.
- `packages/logger/src/otel.ts` — setup OpenTelemetry NodeSDK (traces) ativado por env `OTEL_EXPORTER_OTLP_ENDPOINT`; no-op se ausente. `@opentelemetry/sdk-node` + auto-instrumentations (http).

## Arquivos permitidos

- `packages/logger/**`

## Definition of Done

- [ ] `createLogger` emite JSON Pino com PII mascarada.
- [ ] OTel SDK inicia só com endpoint OTLP setado (no-op caso contrário).
- [ ] Contrato `Logger` inalterado (consumidores não quebram).
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

Independe do schema — pode ser feito em paralelo com F0-S03.
