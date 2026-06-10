---
id: F5-S11
title: Frontend custom fields — settings editor + dynamic form renderer + Zod dinâmico
phase: F5
status: in-progress
priority: medium
estimated_size: M
depends_on: [F5-S04]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:41:28Z

---
# F5-S11 — Custom fields (web)

> **source_docs:** `docs/features/PIPELINE.md` §8; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F5-S05
> **blocks:** —

## Objetivo
Custom fields por pipeline: editor na settings (lista com drag-reorder de `CustomFieldDef` — text/number/date/select/multiselect/boolean/currency) persistido em `pipelines.settings.custom_fields[]`, e um **dynamic form renderer** que monta inputs + Zod dinâmico a partir das defs, consumido pelo card create/edit e pelo DealDetailDrawer (F5-S10).

## Escopo (faz)
- `apps/web/features/pipeline/custom-fields/**`: `CustomFieldsEditor` (settings, drag-reorder), `DynamicFieldsForm` (render por `type` + validação Zod construída do `CustomFieldDef`), `CustomFieldsView` (agrupado, read-only para o drawer).

## Fora de escopo
- Schema (defs são jsonb em `pipelines.settings`, F5-S02; CRUD via F5-S04), drawer shell (F5-S10).

## Arquivos permitidos
- `apps/web/features/pipeline/custom-fields/**`

## Definition of Done
- [ ] Editor adiciona/edita/reordena defs e salva via `PUT /pipelines/:id`; `DynamicFieldsForm` renderiza por tipo e valida (required/options) com Zod dinâmico.
- [ ] Deal inválido após mudança de schema mostra warning graceful (§14), não quebra.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 form claro por tipo (select/multiselect com chips, currency com máscara BRL); estados de erro inline; tokens DS v2 (zero hex).

## Permission scope
- Editar defs → `pipeline.edit` (ADMINS); preencher valores no deal → `deal.edit` (STAFF).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- O `DynamicFieldsForm` é importado por F5-S10 (drawer) e pela criação de deal (F5-S09) — exporte-o estável.
