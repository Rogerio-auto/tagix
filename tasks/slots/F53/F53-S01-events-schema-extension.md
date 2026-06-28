---
id: F53-S01
title: Estender events com priority + novos type/status
phase: F53
status: available
priority: high
estimated_size: S
depends_on: []
blocks: [F53-S02, F53-S05, F53-S07]
agent_id: db-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/features/CALENDAR.md
---

# F53-S01 — Estender events com priority + novos type/status

## Objetivo

Estender a tabela `events` (Calendar 2.0) para suportar compromissos comerciais no Cockpit: nova coluna
`priority`, novos valores de `type` e `status`, via migration idempotente e retrocompatível. **Sem
sistema novo — `events` é a fonte única de compromissos.**

## Contexto

`events` já tem `contactId`/`dealId`/`conversationId`/recorrência/RLS. `type` e `status` são colunas
`text` com check constraints (`events_type_chk`, `events_status_chk`). A Agenda Inteligente (F53)
precisa de prioridade e de tipos/estados de follow-up. Desbloqueia API (S02), worker de lembrete (S05)
e o port de automação (S07).

## Escopo

### files_allowed

- `packages/db/src/schema/calendar.ts`
- `packages/db/drizzle/**` (apenas o novo arquivo de migration + journal/meta gerado)
- `packages/db/src/repos/calendar.ts` (apenas se precisar expor tipo derivado; não obrigatório)

### files_forbidden

- `apps/**`, `packages/db/src/schema/*` que não seja `calendar.ts`

## Escopo (faz)

- Adicionar coluna `priority` em `events`: `text('priority').notNull().default('medium')` + check
  `events_priority_chk` (`low|medium|high`).
- Estender `events_type_chk` para incluir `call`, `whatsapp`, `billing`, `proposal`, `custom` (mantendo
  `meeting|demo|follow_up|task|reminder|other`).
- Estender `events_status_chk` para incluir `in_progress`, `postponed` (mantendo
  `scheduled|confirmed|cancelled|completed`).
- Migration versionada idempotente: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` para as duas checks;
  `ADD COLUMN IF NOT EXISTS priority`. Sequenciada após a última migration (sem colisão de journal).

## Fora de escopo

- `metadata.dueAction` é só convenção jsonb validada por Zod (S02/S05) — **nenhuma coluna nova** para isso.
- Validação de transição de status (S02). Emissão/consumo de eventos (S05).

## Contratos de saída

- Tipos Drizzle de `events` exportados refletem `priority` e os novos valores aceitos pelas checks.
- Migration aplica limpo em banco com dados legados (defaults preservados; linhas antigas válidas).

## Definition of Done

- [ ] Coluna `priority` + check criados; checks de `type`/`status` recriadas com os novos valores.
- [ ] Migration idempotente (rodar 2× não falha) e aplicada no dev (`drizzle` migrate verde).
- [ ] RLS de `events` permanece intacta (sem regressão — `events` já é workspace-scoped).
- [ ] `pnpm typecheck` e `pnpm lint` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

`events` já tem RLS por `workspace_id` — este slot **não** cria tabela nova, então não há policy nova,
mas a fronteira multi-tenant deve permanecer. Não tocar nas constraints de `event_participants`.
