---
id: F55-S05
title: 3 métricas novas de Negócio — Placar IA×Humano, ROI da IA, Funil de pipeline (backend)
phase: F55
status: available
priority: high
estimated_size: M
depends_on: [F55-S04]
blocks: [F55-S07]
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/features/PERMISSIONS.md
---
# F55-S05 — Métricas novas de Negócio (backend)

## Objetivo

Adicionar as 3 métricas que são o diferencial do dashboard novo, como módulos do registry (S04):
**Placar IA × Humano**, **ROI da IA** e **Funil de pipeline**. Tudo factível com o schema atual.

## Contexto

S04 entrega o registry declarativo: adicionar card = 1 módulo + 1 registro. Dados-fonte já existem:
- `conversion_events`: `triggeredByMemberId` (humano) vs `triggeredByAgentId` (IA), `valueCents`, `occurredAt`, `cancelledAt`.
- `llm_usage_logs`: `costUsd`, `isTest` (filtrar `is_test=false`) — custo da IA.
- `deals`/`stages`: `valueCents`, `stageId`, `closedAt`, `closedWon`, `createdAt` — funil/win rate/ciclo.

## Escopo

### files_allowed
- `apps/api/src/services/dashboard/metrics/negocio/**` (3 módulos novos)
- `apps/api/src/services/dashboard/metrics/registry.ts` (registrar os 3)
- `apps/api/src/services/dashboard/queries.ts` (helpers SQL novos, se mantido como lib)
- `apps/api/src/services/dashboard/__tests__/**`

### files_forbidden
- `apps/web/**` (cards de front são S07), `packages/db/**`, `apps/workers/**`

## Escopo (faz)
- **placar_ia_humano** (cardType dedicado, ex. `scoreboard` ou reuso de `chart`/`table` com 2 séries):
  conversões e receita do mês atribuídas a IA (`triggeredByAgentId NOT NULL`) vs humano
  (`triggeredByMemberId NOT NULL`), líquido de `cancelledAt`. Roles: `SUP_UP` (OWNER/ADMIN/SUP). Gated por `requiresConversionType`.
- **roi_ia** (stat): receita atribuída à IA no mês ÷ custo IA do mês (`llm_usage_logs` `is_test=false`).
  Retornar `{ receitaCents, custoUsd, roi }`; `null` se custo 0 (evitar divisão por zero → o front omite). Roles: `ADMIN_RO`.
- **funil_pipeline** (table/chart de barras por estágio): por `stage` (ordenado por `position`): valor aberto
  (`SUM(value_cents)` de deals não fechados), contagem; + win rate do mês (`closedWon=true` ÷ fechados) e
  ciclo médio (`AVG(closed_at − created_at)` dos ganhos). Roles: `SUP_RO`.
- Registrar os 3 no registry; declarar `MetricDefinition` (key/label/category='negocio'/roles/cadence/scope/cardType/drillHref).
- Cadência: `mv_1h`/`snapshot_5min` conforme custo (não usar live caro). Definir drillHref para `/conversions`, `/settings/usage`, `/pipeline`.

## Fora de escopo
- Componentes visuais (S07). Registry core (S04). Schema (não precisa — dados já existem).

## Contratos de saída
- 3 keys novas no payload `/api/dashboard/me` para os roles certos: `placar_ia_humano`, `roi_ia`, `funil_pipeline`.
- Drill via `/metrics/:key` para cada (autorizado por role).

## Permission scope
`placar_ia_humano`/`funil_pipeline`: SUPERVISOR+ (visão de equipe/negócio). `roi_ia`: ADMIN+ (custo IA é
sensível, igual aos cards de custo existentes em `PERMISSIONS.md`/`DASHBOARD.md §2.4`). Filtragem server-side
pelo registry; nunca vazar para AGENT.

## Definition of Done
- [ ] 3 módulos auto-contidos em `metrics/negocio/` + registrados; aparecem só para os roles certos.
- [ ] Queries usam `is_test=false` (custo), `cancelledAt IS NULL` (conversões), `WHERE workspace_id` em MV.
- [ ] ROI lida com custo 0 (retorna null, sem divisão por zero).
- [ ] Testes: atribuição IA vs humano correta; ROI; funil por estágio. Cada um respeitando role.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @hm/api test` verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Reusar padrões de query existentes (`conversoesPorAtendenteHumano`/`conversoesPorAgenteIa` já fazem o split
IA/humano — o Placar agrega ambos lado a lado). Se introduzir `cardType` novo (`scoreboard`), declará-lo no
tipo `CardType` (em `metrics/types.ts`, dentro de files_allowed) e o front (S07) mapeia.
