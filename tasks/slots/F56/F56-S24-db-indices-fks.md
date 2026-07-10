---
id: F56-S24
title: DB — índices dos schedulers + FKs pendentes
phase: F56
status: done
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: db-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-10T04:02:17Z

---
# F56-S24 — Índices dos schedulers + FKs pendentes (DB-03/04/05/06, ESC-04)

> **Origem:** AUDITORIA_TECNICA.md §3.8. Schedulers cross-tenant fazem seq scan por falta de índice; FKs de `conversations`/`messages` estão pendentes apesar das tabelas já existirem.

## Objetivo

Eliminar os seq scans dos schedulers e restaurar a integridade referencial pendente.

## Contexto / causa raiz (verificada)

- **DB-03:** `events` sem índice global em `start_at` (calendar-reminders escaneia por tick).
- **DB-05:** `agent_executions` sem `(workspace_id, started_at)` nem `(status)`.
- **ESC-04:** `conversations` sem índice em `ai_mode` (reengagement seq scan).
- **DB-06:** `conversations.department_id/team_id/agent_id` e `messages.sender_agent_id` sem `.references()`.

## Escopo (faz)

- Migration `0064_f56_scheduler_indexes_fks.sql`:
  - `CREATE INDEX idx_events_start_active ON events (start_at) WHERE status <> 'cancelled'`.
  - `agent_executions (workspace_id, started_at DESC)` + `(status) WHERE status IN ('running','interrupted')`.
  - `conversations (workspace_id) WHERE ai_mode='paused'` (parcial).
  - FKs `ON DELETE SET NULL` em conversations/messages.
- Refletir os índices/FKs nos `schema/*.ts`.

## Escopo (não faz)

- Índice de `campaigns.next_tick_at` (F56-S03, dono de `campaigns.ts`). Partição/retenção (DB-01/S25).

## Arquivos permitidos

- `packages/db/src/schema/calendar.ts`
- `packages/db/src/schema/agent_executions.ts`
- `packages/db/src/schema/conversations.ts`
- `packages/db/src/schema/messages.ts`
- `packages/db/drizzle/0064_f56_scheduler_indexes_fks.sql`

## Arquivos proibidos

- `packages/db/src/schema/campaigns.ts` (F56-S03) · `packages/db/src/schema/flows.ts` (F56-S13) · `packages/db/src/schema/webhook_events.ts` (F56-S25) · `packages/db/drizzle/meta/**`

## Definition of Done

- [ ] Índices criados; `EXPLAIN` das queries dos schedulers usa índice (não seq scan).
- [ ] FKs adicionadas com `ON DELETE SET NULL`; deletar agente/time não deixa referência órfã.
- [ ] `pnpm --filter @hm/db test` verde.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Criar índices com `CONCURRENTLY` em prod (fora de transação) — documentar no PR.
- `meta/_journal.json` regenerado pelo integrador (evita colisão com S03/S08/S13/S25).
