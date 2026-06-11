---
id: F6-S01
title: Schema campaigns (+ steps/recipients/deliveries/metrics/followups + scheduled_followups) + RLS
phase: F6
status: available
priority: critical
estimated_size: L
depends_on: []
---
# F6-S01 — Schema Campaigns

> **source_docs:** `docs/DATA_MODEL.md` §11; `docs/features/CAMPAIGNS.md` §3, §8.4; `docs/ROADMAP.md` F6-S01
> **blocks:** F6-S03, F6-S04, F6-S05, F6-S06, F6-S07

## Objetivo
Modelar o domínio Campaigns em Drizzle + Postgres com RLS: `campaigns` (status DRAFT/SCHEDULED/RUNNING/PAUSED/COMPLETED/CANCELLED + `send_windows`/`rate_limit`/`auto_handoff`/`next_tick_at` jsonb/cols), `campaign_steps`, `campaign_recipients`, `campaign_deliveries` (com **idempotency_key UNIQUE**), `campaign_metrics` (rolling), `campaign_followups`, e `scheduled_followups` (fila durável — §8.4, NÃO setTimeout).

## Escopo (faz)
- `packages/db/src/schema/campaigns.ts`: as 6 tabelas de §11 + `scheduled_followups` (`campaign_id, recipient_id, followup_id, scheduled_at, status, attempts`), CHECKs de enum (status de campaign/recipient/delivery), índices (`idx_campaign_recipients_status`, `idx_campaign_deliveries_campaign_status`, UNIQUE idempotency).
- Barrel `schema/index.ts` (+ `RLS_TABLES`); migration de tabela + RLS por `app.workspace_id`.
- Colunas de opt-in já existem em `contacts` (F1-S05) — se faltar `opt_out_at`/`opt_out_reason`, adicionar nesta migration.

## Fora de escopo
- API/UI/worker; FK retroativa em `conversion_events.attributed_campaign_id` (deixar como está — uuid sem FK; nota abaixo).

## Arquivos permitidos
- `packages/db/src/schema/campaigns.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] 7 tabelas criadas conforme §11 + §8.4; `campaign_deliveries.idempotency_key` UNIQUE.
- [ ] RLS criada e testada nas tabelas com `workspace_id`.
- [ ] Migrations geradas via drizzle-kit (RLS custom sem editar journal à mão).
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- `conversion_events.attributed_campaign_id` ficou uuid SEM FK na F5 (campaigns não existia). Opcional: adicionar a FK agora — mas é polish, fora do DoD; se fizer, é migration isolada.
- `scheduled_followups` é o que substitui o setTimeout do v1 (sobrevive crash).
