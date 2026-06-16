---
id: F34-S03
title: Resolução department-aware do agente em loadContext
phase: F34
status: review
priority: high
estimated_size: M
depends_on:
  - F34-S01
blocks:
  - F34-S07
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-06-16T04:00:47Z
completed_at: 2026-06-16T04:04:33Z

---
# F34-S03 — Resolução por departamento

## Objetivo

Quando a IA engaja uma conversa e ela ainda não tem agente fixado, resolver o agente pelo **departamento da conversa** (agente de entrada `is_default`), persistir o agente na conversa (sticky) e cair no comportamento atual quando não há departamento/default.

## Contexto

O agente da conversa é resolvido em `store.loadContext(workspaceId, trigger)` (`apps/workers/src/agents/run.ts`, classe `DbAgentRunStore`), que devolve `ctx.agentId`. Hoje resolve a partir de `conversation.agent_id` → fallback default do workspace, **sem olhar o departamento**. Consome o repo `agent_departments` (S01).

## Escopo (faz)

- **`apps/workers/src/agents/run.ts`** — na resolução do agente dentro de `loadContext` (ou helper chamado por ela):
  1. Se `conversation.agent_id` já está setado → usa ele (sticky; transferências de S04/S05 persistem aqui).
  2. Senão, se `conversation.department_id` não é nulo → `getDefaultAgentForDepartment(department_id)` (repo S01). Achou → usa.
  3. Fallback: comportamento atual (default do workspace) quando não há departamento ou o dept não tem default.
  4. **Persistir** o agente resolvido em `conversations.agent_id` (sticky) na mesma transação RLS, para turnos seguintes e para o cockpit (S04) exibir.
- **`apps/workers/src/agents/agents.test.ts`** — testes: (a) conversa com `agent_id` setado → mantém; (b) sem agent_id mas com department_id que tem default → resolve o default + persiste; (c) sem dept/sem default → fallback atual.

## Fora de escopo

- UI / endpoint de troca manual (S04).
- Tool de transferência autônoma (S05).
- Rodízio/least-busy (D2 = default designado; não implementar distribuição aqui).
- Schema/repo (S01).

## Arquivos permitidos

- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/agents.test.ts`

## Arquivos proibidos

- `apps/workers/src/agents/worker.ts`
- `apps/workers/src/agents/buffer.ts`
- `apps/workers/src/inbound/**`
- `packages/db/**`

## Contratos de entrada/saída

- Entrada: `getDefaultAgentForDepartment(departmentId)` do repo `agent_departments` (S01).
- Efeito: `conversations.agent_id` passa a ser preenchido (sticky) quando resolvido por departamento.

## Definition of Done

- [ ] `loadContext` resolve o agente pelo default do departamento quando `conversation.agent_id` é nulo.
- [ ] O agente resolvido é persistido em `conversations.agent_id`.
- [ ] Fallback ao comportamento atual quando não há departamento/default (sem regressão nos testes existentes do worker de agentes).
- [ ] `pnpm typecheck` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

A persistência sticky precisa rodar na transação RLS já aberta por `loadContext` (não abrir conexão nova). Garantir idempotência: se dois turnos concorrerem, o segundo vê `agent_id` já setado e não sobrescreve. Não alterar a regra de `ai_mode`/`agent_status` (skip quando `ai_mode!='on'` ou agente inativo) que já existe em `run.ts`.
