---
id: F36-S10
title: Settings + Knowledge + Conversões responsivos
phase: F36
status: done
priority: medium
estimated_size: M
depends_on:
  - F36-S01
  - F36-S05
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T01:53:54Z
completed_at: 2026-06-18T02:00:53Z

---
# F36-S10 — Settings + Knowledge + Conversões

## Objetivo

Tornar responsivas as telas de configuração (índice + canais + calendar + conversões + pipeline settings), Knowledge (docs + upload) e Conversões (lista + métricas).

## Contexto

Forms seccionados, listas e upload. Consome `ResponsiveTable` (S05) + `Sheet` (S01).

## Escopo (faz)

- **`apps/web/features/settings/**`** + **`apps/web/app/(app)/settings/**`** + **`apps/web/app/(app)/pipeline/settings/page.tsx`** — `< md`: navegação de seções empilhada (lista → seção), forms em coluna com **save fixo no rodapé**, inputs 16px.
- **`apps/web/features/knowledge/**`** + **`apps/web/app/(app)/knowledge/page.tsx`** — lista de docs em cards; upload e feedback usáveis no toque; detalhe em sheet.
- **`apps/web/features/conversions/**`** + **`apps/web/app/(app)/conversions/page.tsx`** — lista via `ResponsiveTable`; métricas full-width.
- `md+`: tudo inalterado.

## Fora de escopo

- Mudança de APIs. Settings/me de notificações/atalhos (já existentes, só herdam o padrão).

## Arquivos permitidos

- `apps/web/features/settings/**`
- `apps/web/features/knowledge/**`
- `apps/web/features/conversions/**`
- `apps/web/app/(app)/settings/**`
- `apps/web/app/(app)/knowledge/page.tsx`
- `apps/web/app/(app)/conversions/page.tsx`
- `apps/web/app/(app)/pipeline/settings/page.tsx`

## Arquivos proibidos

- `apps/web/features/pipeline/board/**` (S04), `apps/web/features/contacts/**` (S05), `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: settings (seções empilhadas + save fixo), knowledge (cards + upload/feedback) e conversões (cards) usáveis.
- [ ] `md+`: inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.8 forms (não mega-form; save fixo); §2.6 estados; §2.3 sheet; inputs 16px (sem zoom iOS).

## Notas

Pipeline settings vive em `features/pipeline/settings` (disjunto do board da S04). Reusar `ResponsiveTable` (S05) em conversões.
