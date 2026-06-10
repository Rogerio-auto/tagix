---
id: F5-S15
title: Seeds de nicho — pipeline templates (imobiliária + clínica) + agent_template variants + onboarding wizard
phase: F5
status: done
priority: medium
estimated_size: M
depends_on: [F5-S02, F5-S04]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:33:55Z
completed_at: 2026-06-10T22:40:20Z

---
# F5-S15 — Seeds de nicho

> **source_docs:** `docs/ROADMAP.md` F5-S11, F5-S12; `docs/features/PIPELINE.md` §1; `docs/PRD.md` (nichos prioritários)
> **blocks:** —

## Objetivo
Tornar o produto "out-of-the-box" para os 2 nichos canônicos: templates de pipeline (stages + automation/transition rules) para **imobiliária** e **clínica**, variantes de `agent_templates` por nicho (`sales_real_estate`, `support_clinic`, …) com prompts polidos, e um onboarding wizard "criar workspace a partir de nicho".

## Escopo (faz)
- `packages/db/src/seed/pipeline_templates.ts` + `packages/db/src/seed/agent_templates_niche.ts`: seeds idempotentes dos 2 nichos (pipeline stages + custom fields + agent template variants habilitando a tool `move_deal_stage`).
- `apps/web/features/onboarding/**`: wizard "escolha um nicho → cria pipeline + agente a partir do template".
- Registrar os seeds no `seed.ts` (gap-fill orchestrator se necessário).

## Fora de escopo
- Schema (F5-S02), API de pipeline (F5-S04), demais nichos (pós-MVP).

## Arquivos permitidos
- `packages/db/src/seed/pipeline_templates.ts`
- `packages/db/src/seed/agent_templates_niche.ts`
- `apps/web/features/onboarding/**`

## Definition of Done
- [ ] Seed cria pipelines+stages de imobiliária e clínica (idempotente); variantes de agent_templates aparecem no wizard de criação de agente.
- [ ] Onboarding wizard cria workspace a partir do nicho (pipeline + agente).
- [ ] `pnpm --filter @hm/db test` + `pnpm --filter @hm/web build` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **backend-engineer** (seeds) + **frontend-engineer** (wizard) — se preferir, divida em 2 slots sequenciais (seeds → wizard).
- Apenas imobiliária + clínica no MVP (decisão ROADMAP); demais verticais pós-MVP.
