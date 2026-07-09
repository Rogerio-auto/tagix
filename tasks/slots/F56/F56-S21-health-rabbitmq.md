---
id: F56-S21
title: /health checa RabbitMQ (backbone de mensageria)
phase: F56
status: available
priority: medium
estimated_size: XS
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S21 — Health check inclui RabbitMQ (QA-10)

> **Origem:** AUDITORIA_TECNICA.md §3.10. `/health` valida DB e Redis mas não RabbitMQ; RMQ morto retorna 200 "ok" enquanto mensagens somem.

## Objetivo

Fazer `/health` refletir a saúde do RabbitMQ, degradando para 503 quando indisponível.

## Contexto / causa raiz (verificada)

`apps/api/src/health.ts:22-37` checa só `db` + `redis`.

## Escopo (faz)

- Adicionar checagem de conexão AMQP (ou profundidade de fila) ao `/health`; 503 quando falha.

## Escopo (não faz)

- Healthcheck dos containers (F56-S18). `/healthz` dos workers (F56-S17).

## Arquivos permitidos

- `apps/api/src/health.ts`
- `apps/api/src/health.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`

## Definition of Done

- [ ] `/health` retorna 503 quando o RabbitMQ está indisponível (teste).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Reusar o cliente AMQP compartilhado; checagem leve (canal aberto), sem publicar.
