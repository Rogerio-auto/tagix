---
id: F55-S03
title: Recriar mv_dashboard_daily_30d sobre resolved_at (não updated_at)
phase: F55
status: done
priority: high
estimated_size: S
depends_on: [F55-S01]
blocks: []
agent_id: db-engineer
source_docs:
  - docs/features/DASHBOARD.md
completed_at: 2026-06-29T22:51:19Z

---
# F55-S03 — MV de 30 dias sobre resolved_at real

## Objetivo

Recriar a materialized view `mv_dashboard_daily_30d` para contar "resolvidas" por `resolved_at` (timestamp
real, S01) em vez de `updated_at` (proxy impreciso atual). A série de desempenho de 30 dias passa a refletir
resolução de verdade.

## Contexto

`mv_dashboard_daily_30d` (migration 0054) tem 3 CTEs em FULL OUTER JOIN: `day, resolvidas, conversoes,
conversoes_valor_cents, novos_contatos`. A coluna `resolvidas` usa hoje `updated_at` como proxy porque
`resolved_at` não existia. Com S01, existe. O nome da view **não muda** → o refresh worker
(`mv-refresh-job.ts`, array `MATERIALIZED_VIEWS`) continua funcionando sem alteração, e
`serieDesempenho30d` (S04) continua lendo a mesma view.

## Escopo

### files_allowed
- `packages/db/drizzle/0060_f55_mv_daily_30d_resolved.sql` (NOVO — DROP + CREATE da MV + unique index + GRANT)
- `packages/db/drizzle/meta/**`

### files_forbidden
- `apps/**` (worker não muda — mesmo nome de view), `packages/db/src/schema/**`

## Escopo (faz)
- `DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_daily_30d;` + recriar idêntica EXCETO o CTE de resolvidas,
  que passa a usar `resolved_at` (ex.: `COUNT(*) FILTER (WHERE resolved_at::date = day)` na janela de 30d).
- Recriar o **unique index** (necessário para `REFRESH ... CONCURRENTLY`) e o `GRANT SELECT ... TO hm_app`
  (espelhar exatamente o que a 0054 fazia).
- Manter as outras colunas (conversoes/valor/novos_contatos) com a mesma definição da 0054.

## Fora de escopo
- Colunas de origem (S01). Worker de refresh (inalterado). Query de leitura (S04).

## Contratos de saída
- `mv_dashboard_daily_30d.resolvidas` agora deriva de `resolved_at` — consumido por `serieDesempenho30d` (S04).

## Definition of Done
- [ ] Migration dropa e recria a MV + unique index + grant; aplica em DB dev sem erro.
- [ ] `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_daily_30d` funciona (unique index presente).
- [ ] Spot-check: dia com conversa resolvida aparece com `resolvidas >= 1` após backfill (S01) + refresh.
- [ ] `pnpm typecheck`, `pnpm lint` verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
MVs não vivem no schema Drizzle (migration custom, como 0033/0054). MV não tem RLS → manter o padrão de
`WHERE workspace_id` explícito é responsabilidade da query de leitura (S04), não da MV.
