---
id: F10-S06
title: Performance audit + bundle optimization + Lighthouse
phase: F10
status: in-progress
priority: medium
estimated_size: M
depends_on: [F10-S05]
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S06
claimed_at: 2026-06-12T14:39:03Z

---
# F10-S06 — Performance + bundle + Lighthouse

> **source_docs:** `docs/ROADMAP.md` F10-S06
> **blocks:** —

## Objetivo

Auditoria de performance do `@hm/web`: medir Lighthouse, reduzir bundle (code-split de rotas pesadas, dynamic import de libs grandes — flow-builder/charts), otimizar imagens/fontes, e documentar ganhos em `docs/performance/`.

## Contexto

Next.js 15 App Router + React 19. Depende de F10-S05 porque ambos tocam `apps/web/shared`. Performance é restrição de design (CLAUDE.md), não fase de otimização — aqui validamos que segue dentro do alvo.

## Escopo (faz)

- `apps/web/next.config.mjs`: bundle analyzer (opt-in), otimizações (modularizeImports, images, compress).
- `apps/web/shared/**`: `next/dynamic` para componentes pesados (editor de flow, gráficos), lazy boundaries, memoização onde medido.
- `docs/performance/**`: relatório Lighthouse (antes/depois), tabela de bundle por rota, decisões.

## Fora de escopo

- a11y (F10-S05) e e2e (F10-S03).
- Backend/infra perf (índices PG já são restrição de schema).

## Arquivos permitidos

- `apps/web/next.config.mjs`
- `apps/web/shared/**`
- `docs/performance/**`

## Arquivos proibidos

- `packages/ui/**`, `packages/design-tokens/**` (F10-S04/S05)
- `apps/web/e2e/**` (F10-S03)

## Definition of Done

- [ ] Lighthouse (Performance) dentro do alvo nas rotas principais; relatório antes/depois em `docs/performance/`.
- [ ] Rotas/libs pesadas com code-split (`next/dynamic`); bundle por rota documentado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- **§3.6** (skeleton loading): lazy boundaries mostram skeleton, não tela branca.
- Sem regressão de §2.7 (feedback de ação) ao introduzir dynamic imports.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- `blocked` até F10-S05 (compartilham `apps/web/shared`). Fecha a lane de frontend S04→S05→S06.
