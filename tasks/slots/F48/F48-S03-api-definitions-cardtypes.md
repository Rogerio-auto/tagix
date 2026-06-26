---
id: F48-S03
title: Definitions + load-dashboard — cardTypes leaderboard/feed/timeseries
phase: F48
status: done
priority: high
estimated_size: S
depends_on: [F48-S02]
blocks: [F48-S08]
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
completed_at: 2026-06-26T01:15:27Z

---
# F48-S03 — Registrar métricas novas e cardTypes no server-driven

## Objetivo

Estender o catálogo server-driven com os 3 cardTypes novos (`leaderboard`, `feed`, `timeseries`) e
registrar as métricas `leaderboard_produtividade`, `leads_recentes` e `desempenho_30d`, fazendo o
`load-dashboard` resolver os valores via as queries do S02 — tudo role-gated, sem `if(role)` no front.

## Contexto

`definitions.ts` é a fonte da verdade de quem vê o quê (DASHBOARD §8). `load-dashboard.ts` mapeia
metric_key → query. Mantém o contrato: o front só renderiza por `cardType` (registry no S08).

## Escopo (faz)

- `definitions.ts`:
  - `CardType` += `'leaderboard' | 'feed' | 'timeseries'`.
  - Métrica `leaderboard_produtividade` — `cardType: 'leaderboard'`, `category: 'atendimento'`,
    `roles: SUP_RO`, `cadence: 'snapshot_5min'`, `scope: 'team'`.
  - Métrica `leads_recentes` — `cardType: 'feed'`, `category: 'atendimento'`, `roles: SUP_RO`,
    `cadence: 'socket'`, `scope: 'workspace'`, `drillHref: () => '/contacts'`.
  - Métrica `desempenho_30d` — `cardType: 'timeseries'`, `category: 'negocio'`, `roles: SUP_RO`,
    `cadence: 'mv_1d'`, `scope: 'workspace'`.
- `load-dashboard.ts` `resolveValue`: casos novos chamando `leaderboardProdutividade`,
  `leadsRecentes`, `serieDesempenho30d` (do S02).
- Atualizar `load-dashboard.test.ts` para cobrir que SUP+ recebe os 3 novos cards e AGENT não.

## Fora de escopo

- Implementar as queries (S02). Render no front (S08). Widgets (S05/S06/S07).

## Arquivos permitidos

- `apps/api/src/services/dashboard/definitions.ts`
- `apps/api/src/services/dashboard/load-dashboard.ts`
- `apps/api/src/services/dashboard/load-dashboard.test.ts`

## Arquivos proibidos

- `apps/api/src/services/dashboard/queries.ts` (S02), `packages/db/**` (S01)
- `apps/web/**` (S04–S08)

## Contratos de saída (payload `GET /dashboard/me`)

- `{ key:'leaderboard_produtividade', cardType:'leaderboard', value:{ rows:[...] } }`
- `{ key:'leads_recentes', cardType:'feed', value:{ rows:[...] } }`
- `{ key:'desempenho_30d', cardType:'timeseries', value:{ series:[...] } }`

## Definition of Done

- [ ] Os 3 cardTypes novos compilam em todo o pipeline (definitions → load → payload).
- [ ] `metricsForRole(SUP_RO)` inclui os 3; `metricsForRole('AGENT')` não inclui nenhum.
- [ ] `resolveValue` retorna o shape do S02 para cada key; default segue `null` (card vazio omitido).
- [ ] `load-dashboard.test.ts` cobre visibilidade por role dos 3 novos cards.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

- Os 3 cards são SUP_RO (SUPERVISOR/ADMIN/OWNER/READONLY) — supervisão de equipe e negócio
  (DASHBOARD §3.2/§3.3/§3.4). AGENT não vê leaderboard/feed/série. READONLY vê sem ação.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Reusar os atalhos de role já definidos (`SUP_RO`).
- `leads_recentes` com cadence `socket` mantém a lista quente; o `useDashboardSocket` já invalida a
  query no front quando há atividade (sem mudança no socket aqui).
