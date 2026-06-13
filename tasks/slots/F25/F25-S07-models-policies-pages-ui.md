---
id: F25-S07
title: Páginas Modelos + Políticas (frontend) — catálogo LLM + editor de policy por workspace
phase: F25
status: done
priority: medium
estimated_size: L
depends_on: [F25-S02, F25-S03, F25-S06]
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T01:44:53Z
completed_at: 2026-06-13T01:46:07Z

---
# F25-S07 — Páginas Modelos + Políticas

> **source_docs:** `docs/ROADMAP.md` F2.5-S02/S03; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Duas páginas do painel: **LlmModelsCatalog** (lista a whitelist, ativa/desativa, edita default_plan_keys/notes, botão "Sync OpenRouter") e **WorkspaceAgentPolicies** (seleciona workspace, edita allowed_models, flags LangGraph e caps) — consumindo as APIs F25-S02/S03, em DS v2 dark-first.

## Contexto

Shell/nav vêm do F25-S06. APIs: catálogo (S02), policies (S03). Páginas preenchem o route group `(platform)`.

## Escopo (faz)

- `apps/web/app/(platform)/models/page.tsx` + `apps/web/features/platform-admin/models/**`: tabela da whitelist (toggle is_active, edição inline de notes/default_plan_keys, ação Sync com feedback de progresso/resultado).
- `apps/web/app/(platform)/policies/page.tsx` + `apps/web/features/platform-admin/policies/**`: seletor de workspace + formulário da policy (allowed_models como multi-select da whitelist ativa, switches das flags, inputs dos caps) com validação client + save.

## Fora de escopo

- Shell/nav/guard (S06). Secrets/Usage (S08). Backend (S02/S03).

## Arquivos permitidos

- `apps/web/app/(platform)/models/**`
- `apps/web/app/(platform)/policies/**`
- `apps/web/features/platform-admin/models/**`
- `apps/web/features/platform-admin/policies/**`

## Arquivos proibidos

- `apps/web/features/platform-admin/shell/**`, `apps/web/features/platform-admin/lib/**` (S06 — reusar, não editar), `apps/web/app/(platform)/secrets|usage/**` (S08)

## Definition of Done

- [ ] Catálogo: list + toggle is_active + edit + Sync OpenRouter com feedback; Políticas: seleciona workspace, edita allowed_models/flags/caps, salva com validação.
- [ ] allowed_models só oferece slugs da whitelist ativa; DS v2 dark-first (zero hex); estados de loading (skeleton) e erro humanos.
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§2.8** (form-de-um-monstro): a policy tem muitos campos — agrupar em seções (modelos / features / caps), não um mega-form.
- **§3.6** skeleton no carregamento; **§2.7** feedback claro no Sync e no save.
- **§2.9** (botão-suicida): desativar um modelo em uso avisa do impacto.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa os fetchers/tipos de `features/platform-admin/lib` (S06). Paraleliza com F25-S08.
