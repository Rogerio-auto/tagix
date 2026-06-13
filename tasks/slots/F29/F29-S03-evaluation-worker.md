---
id: F29-S03
title: Worker de avaliação — polling de conversas encerradas → judge → persist
phase: F29
status: blocked
priority: high
estimated_size: M
depends_on: [F29-S01, F29-S02]
agent_id: backend-engineer
source_docs:
  - docs/features/AGENT_QUALITY_OBJECTIONS.md
---

# F29-S03 — Worker de avaliação (Node)

> **source_docs:** `docs/features/AGENT_QUALITY_OBJECTIONS.md` §4
> **blocks:** —

## Objetivo

Worker scheduler que, a cada N minutos, encontra conversas encerradas (`status in ('closed','resolved')`) **sem** avaliação, chama o LLM-judge (F29-S02) e persiste `conversation_evaluations` + `objections` (F29-S01). Idempotente por `UNIQUE(conversation_id)`.

## Contexto

Padrão dos workers `dashboard-refresh`/`calendar-reminders`/`campaigns` (scheduler que faz tick + lote pequeno). Evita tocar o caminho de fechamento de conversa na API. Resolve o ciclo: encerrou → avaliou → métricas (F29-S04).

## Escopo (faz)

- `apps/workers/src/evaluation/**` (novo): `scheduler.ts` (tick periódico), `processor.ts` (seleciona lote de conversas encerradas sem `conversation_evaluations` via LEFT JOIN, nas últimas X horas; backoff por contagem de falha), `index.ts` (registro do worker), `processor.test.ts`.
- Para cada conversa: chama o agent-runtime `/internal/evaluate` (via `@hm/agents-client`) → grava via repo de `@hm/db` (upsert avaliação + insert objections) numa transação. Falha do judge → não persiste, conta tentativa.
- `packages/agents-client/src/**` (editar): adicionar método tipado `evaluate({ workspaceId, conversationId })` que bate em `/internal/evaluate` com o Bearer token (espelha o cliente de `/run` e `/embed`).
- `apps/workers/src/bootstrap/index.ts` (editar): subir o novo worker no bootstrap.

## Fora de escopo

- O prompt/inteligência do judge (F29-S02). Schema (F29-S01). Dashboard (F29-S04/S05).
- Mudança no caminho de fechamento de conversa na API.

## Arquivos permitidos

- `apps/workers/src/evaluation/**`
- `apps/workers/src/bootstrap/index.ts`
- `packages/agents-client/src/**`

## Arquivos proibidos

- `apps/api/**`, `apps/web/**`, `apps/agent-runtime/**`, `packages/db/src/schema/**` (consome o repo do S01, não edita schema).

## Definition of Done

- [ ] Worker faz tick, seleciona só conversas encerradas SEM avaliação, processa lote pequeno; **idempotente** (rodar 2x não duplica — garantido por `UNIQUE(conversation_id)`).
- [ ] Persiste avaliação + objections em transação; falha do judge não persiste parcial e reprograma.
- [ ] `@hm/agents-client.evaluate()` tipado (sem `any`), com auth Bearer.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**. Reusa o `with_workspace`/RLS pelo repo do S01 e o cliente do agent-runtime.
- Lote pequeno + intervalo configurável por env (controle de custo — §6 do doc).
