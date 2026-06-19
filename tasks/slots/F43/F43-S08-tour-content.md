---
id: F43-S08
title: Conteúdo dos tours + âncoras data-tour-id nas telas
phase: F43
status: available
priority: medium
estimated_size: M
depends_on: [F43-S06, F43-S07]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/ONBOARDING.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.4 — passos apontam a ação primária visível de cada tela (path óbvio), não menus escondidos."
  - "Aplica 2.5/3.3 — textos reaproveitam/expandem o conteúdo do HelpHint (explicação real, não 1 linha)."
---

# F43-S08 — Conteúdo dos tours + âncoras

> **source_docs:** `docs/features/ONBOARDING.md` §4.2; `docs/UX_PRINCIPLES.md`
> **depends_on:** F43-S07 (engine), F43-S06 (compartilha `DashboardClient.tsx`)

## Objetivo

Definir os passos dos tours das telas-chave e adicionar as âncoras `data-tour-id` necessárias:
Dashboard, Conversas/Inbox, Pipeline, Agentes, Flows.

## Escopo (faz)

- Config declarativa dos passos por tela (em `apps/web/shared/components/tour/content/**` ou
  colocada junto a cada feature, conforme o engine de F43-S07), reaproveitando textos do `HelpHint`.
- Adicionar `data-tour-id` aos elementos-alvo das 5 telas (ação primária + pontos didáticos).
- Disparo do tour da tela na primeira visita do membro (estado de F43-S01/S04).

## Fora de escopo

- Engine (F43-S07). Estado/persistência (já em S01/S04).

## Arquivos permitidos

- `apps/web/shared/components/tour/content/**`
- `apps/web/features/dashboard/DashboardClient.tsx`
- `apps/web/features/conversations/**`
- `apps/web/features/pipeline/**`
- `apps/web/features/agents/**`
- `apps/web/features/flow-builder/**`

## Arquivos proibidos

- `apps/web/shared/components/tour/{TourProvider,TourSpotlight}.tsx` (engine — F43-S07)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Tours das 5 telas com passos claros; âncoras `data-tour-id` resolvem corretamente.
- [ ] Tour de uma tela só aparece uma vez por membro; respeita dispensa.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. `files_allowed` lista os diretórios de feature reais — confirmar
  os nomes (`conversations`/`agents`/`flow-builder`) ao claimar; ajustar âncoras aos componentes existentes.
- Compartilha `DashboardClient.tsx` com F43-S06 → por isso `depends_on: F43-S06` (edição sequencial).
