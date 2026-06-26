---
id: F51-S01
title: Evento socket flow_execution:updated (@hm/shared)
phase: F51
status: review
priority: high
estimated_size: XS
depends_on: []
blocks: [F51-S03, F51-S04, F51-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T21:29:46Z
completed_at: 2026-06-26T21:31:23Z

---
# F51-S01 — Evento `flow_execution:updated`

## Objetivo

Adicionar o evento socket `flow_execution:updated` (com `status`) ao contrato ServerToClient, base do
monitoramento em tempo real das execuções no cockpit.

## Contexto

Os eventos `flow_execution:started`/`cancelled` existem mas nunca são emitidos e não carregam status.
A feature precisa de um evento único que carregue o estado atual. Consumido por S03/S04 (emissão) e S05
(listener).

## Escopo (faz)

- `packages/shared/src/socket-events.ts`:
  - `FlowExecutionUpdatedPayload { conversationId: string | null; flowId: string; executionId: string;
    status: 'running'|'waiting'|'completed'|'failed'|'cancelled'; nextStepAt: string | null }`.
  - `ServerToClient` += `'flow_execution:updated': (p: FlowExecutionUpdatedPayload) => void`.
  - `SERVER_TO_CLIENT_EVENTS` (array runtime) += `'flow_execution:updated'` — OBRIGATÓRIO (o
    `z.enum(SERVER_TO_CLIENT_EVENTS)` do relay dropa eventos fora do array).
  - Manter `flow_execution:started`/`cancelled` e `FlowExecutionPayload` (sem remover).

## Fora de escopo

- Emissão (S03/S04) e consumo (S05).

## Arquivos permitidos

- `packages/shared/src/socket-events.ts`

## Arquivos proibidos

- Todo o resto.

## Definition of Done

- [ ] `flow_execution:updated` no `ServerToClient` e no array `SERVER_TO_CLIENT_EVENTS`.
- [ ] `FlowExecutionUpdatedPayload` exportado com `status` + `nextStepAt`.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

- `conversationId: string | null` — quando null o relay cai na room `ws:{workspaceId}` (sem conversa).
