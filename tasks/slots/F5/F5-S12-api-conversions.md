---
id: F5-S12
title: API conversões — CRUD conversion_types + events (registrar/listar/cancelar) + dedup
phase: F5
status: review
priority: high
estimated_size: M
depends_on: [F5-S03]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:15:08Z
completed_at: 2026-06-10T22:17:54Z

---
# F5-S12 — API Conversões

> **source_docs:** `docs/DATA_MODEL.md` §10.7; `docs/features/DASHBOARD.md` §13; `docs/features/PERMISSIONS.md` (deal.convert/deal.cancel_conversion); `docs/ROADMAP.md` F5-S13 (parte API)
> **blocks:** F5-S13, F5-S14

## Objetivo
API do sistema de conversões: CRUD de `conversion_types`, `POST /api/conversions` (registro manual com dedup same-day), `GET /api/conversions` (lista filtrada por tipo/período/atribuição) e `POST /api/conversions/:id/cancel`.

## Escopo (faz)
- `apps/api/src/routes/conversions/**`: factory de router (montada em `app.ts` pelo orchestrator) com CRUD de types + register/list/cancel de events, validação Zod (valor obrigatório se `conversion_type.value_required`), RLS, e tratamento do conflito de dedup (`uq_conv_events_dedup`) → 409 claro.
- Captura de atribuição no registro (member/agent/flow/campaign/channel conforme `source`).

## Fora de escopo
- UI (F5-S13), automações/triggers (F5-S14), schema (F5-S03).

## Arquivos permitidos
- `apps/api/src/routes/conversions/**`

## Permission scope
- Registrar → `deal.convert` (STAFF); cancelar → `deal.cancel_conversion` (STAFF); CRUD `conversion_types` → `pipeline.edit`/ADMINS (área de settings). Cite `permissions.ts`.

## Definition of Done
- [ ] CRUD types + register/list/cancel events sob RLS + Zod; dedup same-day retorna 409 com mensagem útil; valor obrigatório validado.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Este é o endpoint que F2-S20 (`register_conversion`) e F5-S14 (automações) chamam internamente — fixe a assinatura de registro aqui.
