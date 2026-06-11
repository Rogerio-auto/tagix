---
id: F6-S03
title: API campaigns — CRUD + validate (pre-flight) + activate/pause/resume + metrics/deliveries
phase: F6
status: in-progress
priority: high
estimated_size: M
depends_on: [F6-S01, F6-S02]
agent_id: backend-engineer
claimed_at: 2026-06-11T04:50:46Z

---
# F6-S03 — API Campaigns

> **source_docs:** `docs/features/CAMPAIGNS.md` §5, §13, §17.2; `docs/features/PERMISSIONS.md` (campaign.*); `docs/ROADMAP.md` F6-S04 (parte campanha)
> **blocks:** F6-S08, F6-S09

## Objetivo
API REST de campanhas (§13): CRUD, `validate` (pre-flight §5: steps existem, templates APPROVED, opt-in p/ MARKETING, quality rating, tier limit, send windows, rate) retornando `{ safe, criticalIssues[], warnings[] }`, `activate`/`pause`/`resume`, e `metrics`/`deliveries`.

## Escopo (faz)
- `apps/api/src/routes/campaigns/**`: factory de router (montada em `app.ts` pelo orchestrator), endpoints §13, validação Zod, RLS.
- `validateCampaign` (§5) usando os helpers de F6-S02 (`fetchMetaTemplate`/`fetchChannelQuality`); aplica também as regras extras de Instagram (§17.2) quando `channel.provider='meta_instagram'` — schema-ready (envio IG completo é F1.5).
- `activate` só com `safe=true`; transições de status corretas.

## Fora de escopo
- Recipients/opt-in (F6-S04), worker de envio (F6-S05), UI (F6-S08/S09).

## Arquivos permitidos
- `apps/api/src/routes/campaigns/**`

## Permission scope
- list/metrics/deliveries → `campaign.list`/`campaign.view_metrics`; create/update → `campaign.edit` (MANAGERS); activate → `campaign.activate` (ADMINS); pause/resume → `campaign.pause` (MANAGERS); delete → `campaign.cancel` (ADMINS). Cite `permissions.ts`.

## Definition of Done
- [ ] CRUD + validate + activate/pause/resume sob RLS + Zod; validate cobre as 7 checagens do §5 (+ extras IG do §17.2).
- [ ] Guards de permissão por endpoint; activate barra se `safe=false`.
- [ ] `pnpm --filter @hm/api test` (graph/db mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Instagram: envio proativo completo é F1.5 (adapter STUB); aqui só as regras de validação schema-ready (§17.2) + bloqueio de recipients sem interação prévia.
