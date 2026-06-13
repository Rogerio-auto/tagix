---
id: F29-S05
title: Dashboard Onda B — frontend (cards qualidade/CSAT + objeções rankeadas)
phase: F29
status: blocked
priority: medium
estimated_size: M
depends_on: [F29-S04]
agent_id: frontend-engineer
source_docs:
  - docs/features/AGENT_QUALITY_OBJECTIONS.md
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
---

# F29-S05 — Dashboard Onda B (frontend)

> **source_docs:** `docs/features/AGENT_QUALITY_OBJECTIONS.md` §5; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Renderizar no dashboard as métricas qualitativas da Onda B entregues pela F29-S04: cards de **qualidade média** e **CSAT** (stat, com distribuição), as tabelas de **qualidade por agente/atendente**, e o card de **objeções rankeadas** com drill-down em drawer mostrando exemplos (excerpts).

## Contexto

Server-driven: o `DashboardClient` renderiza por `cardType` via `cards/registry.tsx`. O `TableCard` já é column-aware (F28-S02), então as tabelas de qualidade/objeções reusam `{columns, rows}`. Só CSAT (distribuição promoter/neutral/detractor) e o detalhe de objeções precisam de tratamento próprio.

## Escopo (faz)

- `cards/StatCard.tsx` (ou variante): exibir CSAT com a distribuição (promoter/neutral/detractor) — barra/segmento compacto, tokens DS.
- `DrillDownDrawer.tsx` + `DashboardClient.tsx`: registrar `objecoes_rankeadas` (e rankings de qualidade) em `DRAWER_METRICS`; drawer de objeções lista exemplos por categoria (excerpt + flag resolvida/não-resolvida).
- `format.ts`/`types.ts`: formatação de score (0-100), label CSAT, % resolvida; tipos sem `any`.
- TableCard reusado para `qualidade_por_agente`/`qualidade_por_atendente`/`objecoes_rankeadas` — ajuste só se a célula precisar de badge (ex.: %resolvida) não coberto.

## Fora de escopo

- Backend/métricas (F29-S04). Schema (F29-S01). Worker (F29-S03).
- Página dedicada de objeções (drill-down em drawer cobre o MVP).

## Arquivos permitidos

- `apps/web/features/dashboard/**`

## Arquivos proibidos

- `apps/web/app/**`, `apps/api/**`, `packages/db/**`, `apps/web/app/(platform)/**`.

## Definition of Done

- [ ] Cards de qualidade média e CSAT renderizam (CSAT com distribuição visual); tabelas qualidade por agente/atendente exibem ranking.
- [ ] `objecoes_rankeadas` abre **drawer lateral** (não modal) com exemplos por categoria (excerpt + estado resolvida).
- [ ] Skeleton no loading; card sem dado (`value: null`) não renderiza. DS v2 dark-first, **zero hex**; sem `any`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- **§2.3/§3.2** detalhe em drawer lateral, nunca modal; **§4** todo número tem destino (drill-down). **§3.6** skeleton; **§2.4** entrada óbvia (cards na grade).
- **a11y**: tabela com `<th scope>`, contraste AAA nos scores; distribuição CSAT com rótulo textual além da cor (não depender só de cor).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa o `TableCard` column-aware e o padrão de drill-down da F28-S02.
