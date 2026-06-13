---
id: F28-S02
title: Dashboard Onda A — frontend (TableCard rico, rankings, cards IA)
phase: F28
status: review
priority: high
estimated_size: M
depends_on: [F28-S01]
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T15:38:01Z
completed_at: 2026-06-13T15:41:07Z

---
# F28-S02 — Dashboard Onda A (frontend)

> **source_docs:** `docs/features/DASHBOARD.md` §3.2, §4; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Renderizar no dashboard as métricas novas da Onda A entregues pelo F28-S01: tornar o **TableCard column-aware** (hoje hardcoded em `status`/`count`) para exibir a **tabela de performance por atendente** (Atendente | Abertas | Resolvidas | T. médio | SLA) e os **rankings de conversões** (por atendente humano / por agente IA), além dos **cards stat operacionais de IA** (handoffs, resoluções, latência p95, cap % com estado de alerta). Drill-down em drawer (§4), nunca modal.

## Contexto

O dashboard é server-driven (`DashboardClient` renderiza por `cardType` via `cards/registry.tsx`). O `StatCard`/`ChartCard` já são genéricos, mas o `TableCard` atual só lê 2 colunas fixas (`TableCard.tsx:43-48`) — insuficiente para a tabela de performance e os rankings, que vêm com `{columns, rows}` (contrato do S01). Este slot é só frontend (`features/dashboard/**`), disjunto da wrap de layout da F27 (que toca a shell `app/(app)/page.tsx`).

## Escopo (faz)

- `cards/TableCard.tsx`: ler `card.value.columns[]` + `rows[]` genéricos (key/label/align), renderizar cabeçalho + linhas; suportar célula de **badge de SLA** (`sla_status`: ok/warning) e destaque de **top performer** (1ª linha do ranking). Ordenável por coluna (client-side) quando aplicável.
- `cards/StatCard.tsx`: suportar estado de **alerta** para `cap_mensal_consumido_pct` (cor warn/danger conforme threshold no payload) — sem hex, tokens DS.
- `DrillDownDrawer.tsx` + `DashboardClient.tsx`: incluir as novas métricas `table` (performance, rankings) no conjunto que abre **drawer** com detalhe expandido (lista completa, links por linha); registrar as keys em `DRAWER_METRICS`.
- `format.ts`/`types.ts`: helpers de formatação (duração `m s`, %) e tipos do payload `{columns, rows}` se necessário (sem `any`).
- `queries.ts` (feature) se precisar mapear drill-down detail das novas keys.

## Fora de escopo

- Backend / definitions / queries (F28-S01).
- Onda B (qualidade/CSAT/objeções — F29).
- Wrap de largura da página (`app/(app)/page.tsx`) — isso é F27-S02.
- Customização de layout pessoal (já existe — F8-S04).

## Arquivos permitidos

- `apps/web/features/dashboard/**`

## Arquivos proibidos

- `apps/web/app/**` (shell é F27; não editar aqui)
- `apps/api/**`, `packages/db/**`, `apps/web/app/(platform)/**`

## Definition of Done

- [ ] `TableCard` renderiza `{columns, rows}` genéricos; tabela de performance por atendente exibe as 5 colunas com badge de SLA; rankings destacam top performer.
- [ ] Cards stat de IA renderizam (handoffs, resoluções, latência p95, tokens/modelo); `cap_mensal_consumido_pct` mostra estado de alerta visual.
- [ ] Drill-down dos novos `table` abre **drawer lateral** (não modal) com detalhe + links por linha (`/conversions?member_id=...`).
- [ ] Skeleton no loading; card sem dado (`value: null`) não renderiza (sem zero enganoso).
- [ ] DS v2 dark-first, **zero hex**; tipagem estrita (sem `any`).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- **§2.3 / §3.2** detalhe em **drawer lateral**, nunca modal full-screen; lista por trás permanece visível.
- **§3.1** selecionar antes de agir: clicar na linha/card abre drill-down; **§4** todo número tem destino (drill-down ou navegação) — sem número solto.
- **§3.6** skeleton loading no lugar do card; **§2.4** entrada óbvia (cards na grade, não menu escondido).
- **§3.8** respeita density; **a11y**: tabela com `<th scope>`, foco navegável, contraste AAA nos números.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Contrato `{columns, rows}` vem do F28-S01 — alinhar as keys de coluna.
- **Paralelismo:** `features/dashboard/**` é disjunto da F26 e da wrap F27-S02 (`app/(app)/page.tsx`). Pode rodar em paralelo à F27 após o F28-S01 fechar.
