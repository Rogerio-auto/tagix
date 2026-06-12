---
id: F10-S10
title: Code-split real das libs pesadas (recharts/xyflow/fullcalendar) via lazyClient
phase: F10
status: available
priority: medium
estimated_size: M
depends_on: []
agent_id: frontend-engineer
source_docs:
  - docs/performance/REPORT.md
  - docs/ROADMAP.md#F10-S06
---

# F10-S10 — Code-split real das libs pesadas

> **source_docs:** `docs/performance/REPORT.md` (§5 follow-ups); follow-up do F10-S06
> **blocks:** F10-S12 (compartilha `features/flow-builder`)

## Objetivo

Aplicar o code-split que o F10-S06 deixou documentado mas não pôde executar (a fronteira do S06 não permitia tocar `features/**`/`app/**`): converter o mount das libs pesadas (recharts no dashboard, `@xyflow/react` no flow editor, `@fullcalendar/*` no calendar) para `next/dynamic` via o helper `lazyClient` já existente (`apps/web/shared/lib/lazy.tsx`), com skeletons (`apps/web/shared/components/feedback`), reduzindo o First Load JS das rotas.

## Contexto

O F10-S06 entregou a camada habilitadora (`lazyClient` + `CanvasSkeleton`/`ChartSkeleton`/`CalendarSkeleton`/`BoardSkeleton`) e mediu os candidatos. Este slot consome essa camada (read-only) e faz os swaps reais documentados na §5 do REPORT. Alvos: −50 kB em `/` (recharts), −80 kB em `/calendar` (fullcalendar), −55 kB em `/flows/[id]` (xyflow).

## Escopo (faz)

- `apps/web/features/dashboard/cards/**`: `ChartCard`/`registry` → recharts atrás de `lazyClient(..., ChartSkeleton)`.
- `apps/web/features/calendar/**`: o componente FullCalendar atrás de `lazyClient(..., CalendarSkeleton, { ssr: false })`.
- `apps/web/features/flow-builder/FlowEditorPage.tsx` (+ `canvas/` apenas se necessário para o mount): `FlowCanvas` (ReactFlow) atrás de `lazyClient(..., CanvasSkeleton, { ssr: false })`.
- `apps/web/app/(app)/**`: `loading.tsx` por rota pesada (`/calendar`, `/flows`, dashboard `page.tsx`) reusando os skeletons de `shared`.

## Fora de escopo

- a11y de teclado dessas telas (F10-S12 — ReactFlow/dnd-kit).
- Editar `next.config.mjs`, `shared/lib/lazy.tsx`, `shared/components/feedback/**` (são do F10-S06, read-only aqui).

## Arquivos permitidos

- `apps/web/features/dashboard/cards/**`
- `apps/web/features/calendar/**`
- `apps/web/features/flow-builder/FlowEditorPage.tsx`
- `apps/web/features/flow-builder/canvas/**`
- `apps/web/app/(app)/calendar/**`
- `apps/web/app/(app)/flows/**`
- `apps/web/app/(app)/page.tsx`
- `apps/web/app/(app)/loading.tsx`

## Arquivos proibidos

- `apps/web/next.config.mjs`, `apps/web/shared/**`, `apps/web/package.json`
- `apps/web/features/conversations/**`, `apps/web/features/pipeline/**` (F10-S12)

## Definition of Done

- [ ] recharts/xyflow/fullcalendar carregados via `lazyClient` (não no bundle inicial da rota); skeleton aparece no carregamento (UX §3.6), sem tela branca nem flash de layout.
- [ ] `pnpm --filter @hm/web build` verde; tabela de First Load por rota antes/depois anexada ao final do `docs/performance/REPORT.md`? (não — REPORT é do S06; registre os números no PR/Notas).
- [ ] Sem regressão funcional nas 3 telas (render, interação básica preservada).
- [ ] `pnpm --filter @hm/web typecheck` + `pnpm --filter @hm/web lint` verdes.

## UX considerations

- **§3.6** (skeleton loading): cada boundary lazy mostra o skeleton correto, nunca tela branca.
- **§2.7** (sem click-fantasma): não introduzir atraso perceptível sem feedback no primeiro paint.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- `ssr: false` para xyflow/fullcalendar (libs client-only). Para recharts, `ssr: false` evita mismatch de hidratação dos charts.
- Reusa `lazyClient` e os skeletons do F10-S06 — não reimplementar.
