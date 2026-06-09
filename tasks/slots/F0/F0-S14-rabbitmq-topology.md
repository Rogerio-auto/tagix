---
id: F0-S14
title: RabbitMQ topology + helper publish/consume + envelope schema
phase: F0
status: in-progress
priority: high
estimated_size: S
depends_on: [F0-S08]
agent_id: backend-engineer
claimed_at: 2026-06-09T22:12:46Z

---
# F0-S14 — RabbitMQ topology + helpers

> **source_docs:** `docs/INFRASTRUCTURE.md` §RabbitMQ/workers

## Objetivo

Pacote/módulo de mensageria: assertion da topologia (exchanges/queues/bindings), helper tipado de publish/consume e envelope padrão (Zod), reutilizável por API e workers.

## Escopo (faz)

- Em `packages/shared` (envelope Zod) + um módulo de mq (decidir: `packages/shared/src/mq` ou novo `packages/mq`; preferir `packages/shared/src/mq` p/ não criar pacote agora).
- `amqplib` connection helper; `assertTopology()` (filas inbound/outbound/media/campaigns/flows + DLX); `publish(envelope)` e `consume(queue, handler)` tipados; envelope `{ id, type, workspaceId, payload, ts }` validado por Zod.

## Arquivos permitidos

- `packages/shared/src/mq/**`, `packages/shared/src/index.ts`

## Definition of Done

- [ ] `assertTopology()` cria exchanges/filas/DLX idempotente.
- [ ] publish/consume tipados com envelope Zod.
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

RabbitMQ já no ar (F0-S02). Workers que consomem entram em F1.
