---
id: F70-S26
title: Turno da IA idempotente por envelope
phase: F70
status: in-progress
priority: high
estimated_size: S
depends_on: [F70-S25]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S25-gatilhos-da-ia-e-flows-pela-outbox.md
agent_id: backend-engineer
claimed_at: 2026-09-25T14:11:49Z

---
# F70-S26 — Turno da IA idempotente por envelope

## Objetivo

O cliente nunca receber duas respostas da IA para a mesma mensagem.

## Contexto

Desde a F70-S16/S25 os gatilhos da IA saem pela outbox, com entrega pelo menos uma vez. Um envelope republicado (relay caiu entre publicar e marcar como enviado, ou confirmação fora do prazo) roda o turno de novo: `runAgent` não deduplica por envelope.

## Escopo

### files_allowed

- `apps/workers/src/agents/**`
- `packages/shared/src/mq/agent-run.ts`
- `packages/shared/src/mq/*.test.ts`
- `packages/db/drizzle/**` *(se a reivindicação precisar de coluna ou índice: 0091)*
- `packages/db/src/schema/agents.ts`
- `packages/db/src/schema/agent_executions.ts`

## Escopo (faz)

- O envelope do gatilho carrega um id estável por gatilho (mensagem, retomada, follow-up, troca de agente).
- `runAgent` reivindica o turno atomicamente (ex.: `agent_executions` com índice único pelo id do gatilho) antes de chamar o runtime; o envelope repetido vira no-op com log.
- Um turno que falhou antes de responder pode ser retentado (a reivindicação não pode bloquear a retentativa legítima da fila).

## Definition of Done

- [ ] teste: o mesmo envelope entregue duas vezes (inclusive em paralelo) → um turno, uma resposta
- [ ] teste: turno que falhou antes do runtime → a retentativa roda
