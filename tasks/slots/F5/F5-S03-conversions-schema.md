---
id: F5-S03
title: Schema conversões (conversion_types, conversion_events, conversion_tag_triggers) + RLS + dedup
phase: F5
status: done
priority: high
estimated_size: M
depends_on: [F5-S01, F5-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T21:52:21Z
completed_at: 2026-06-10T21:54:44Z

---
# F5-S03 — Schema Conversões

> **source_docs:** `docs/DATA_MODEL.md` §10.7; `docs/features/DASHBOARD.md` §13; `docs/ROADMAP.md` F5-S13 (parte schema)
> **blocks:** F5-S12, F5-S14

## Objetivo
Modelar o sistema de conversões: `conversion_types` (catálogo por workspace), `conversion_events` (registros com atribuição member/agent/flow/campaign/channel) e `conversion_tag_triggers` (tag → conversão automática). Inclui o índice **UNIQUE de dedup same-day** e os índices parciais de atribuição.

## Escopo (faz)
- `packages/db/src/schema/conversions.ts`: as 3 tabelas de §10.7 com FKs (conversion_type/contact/conversation/deal/member/agent/flow/campaign/channel — todas já existem nas fases anteriores), CHECK de `source`, e:
  - `uq_conv_events_dedup` UNIQUE(workspace_id, contact_id, conversion_type_id, date_trunc('day', occurred_at)) WHERE cancelled_at IS NULL (migration custom — expressão funcional);
  - índices parciais de atribuição (member/agent/type/campaign/contact, todos WHERE cancelled_at IS NULL).
- `conversion_tag_triggers(workspace_id, tag_id → tags, conversion_type_id)` — FK em `tags` (F5-S01).
- Barrel `schema/index.ts` (+ `RLS_TABLES`); migration de tabela + RLS.

## Fora de escopo
- API/UI (F5-S12/S13), automações/triggers (F5-S14), pg-trigger em contact_tags (F5-S14).

## Arquivos permitidos
- `packages/db/src/schema/conversions.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] 3 tabelas conforme §10.7; dedup UNIQUE same-day e índices parciais criados via migration custom.
- [ ] RLS criada e testada nas 3 tabelas.
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- `conversion_events.deal_id` é `ON DELETE SET NULL` (conversão sobrevive ao deal). Atribuição é multi-fonte — só uma FK costuma estar preenchida por evento.
