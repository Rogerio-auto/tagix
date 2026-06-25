---
id: F48-S01
title: MV diária 30d (mv_dashboard_daily_30d) + registro no refresh
phase: F48
status: done
priority: high
estimated_size: S
depends_on: []
blocks: [F48-S02, F48-S03]
agent_id: db-engineer
source_docs:
  - docs/features/DASHBOARD.md
completed_at: 2026-06-25T23:05:42Z

---
# F48-S01 — MV diária de desempenho (30 dias)

## Objetivo

Criar a materialized view `mv_dashboard_daily_30d` (uma linha por `workspace_id` × dia, últimos
30 dias) com as séries de desempenho — conversas resolvidas, conversões (nº + valor) e novos
contatos — e registrá-la no job de refresh das MVs. Base de dados dos gráficos temporais (S07/S08).

## Contexto

Hoje só existem séries de 24h (`mv_dashboard_volume_24h`) e conversões por tipo. O Command Center
v2 precisa de tendência ao longo do tempo (DASHBOARD §5/§9.3). MV diária pré-agregada evita query
pesada no load. As MVs são globais (sem RLS); a leitura (S02) filtra por `workspace_id` explícito.

## Escopo (faz)

- Migration raw SQL `0054_f48_mv_dashboard_daily_30d.sql`:
  - `CREATE MATERIALIZED VIEW mv_dashboard_daily_30d` agregando por `(workspace_id, day)` na janela
    `now() - interval '30 days'`. Colunas: `day date`, `resolvidas int`, `conversoes int`,
    `conversoes_valor_cents bigint`, `novos_contatos int`.
  - Fontes: `conversations` (status in `resolved`/`closed`, `date_trunc('day', updated_at)`),
    `conversion_events` (`cancelled_at IS NULL`, `date_trunc('day', occurred_at)`), `contacts`
    (`deleted_at IS NULL`, `date_trunc('day', created_at)`). Combinar via FULL OUTER JOIN das CTEs
    diárias em `(workspace_id, day)` com `coalesce(...,0)`.
  - `CREATE UNIQUE INDEX mv_dashboard_daily_30d_uq ON mv_dashboard_daily_30d (workspace_id, day)`
    (obrigatório para `REFRESH ... CONCURRENTLY`).
  - `GRANT SELECT ON mv_dashboard_daily_30d TO hm_app;`
  - Entrada correspondente no `drizzle/meta/_journal.json` (seguir padrão do `0033_f8_mv_rls_fk.sql`).
- Adicionar `'mv_dashboard_daily_30d'` ao array `MATERIALIZED_VIEWS` em `mv-refresh-job.ts`.

## Fora de escopo

- Query de leitura da MV (S02). Métricas/definitions (S03). Qualquer frontend.

## Arquivos permitidos

- `packages/db/drizzle/0054_f48_mv_dashboard_daily_30d.sql` (novo)
- `packages/db/drizzle/meta/**` (entrada no journal/snapshot)
- `apps/workers/src/dashboard-refresh/mv-refresh-job.ts` (registrar a MV no refresh)

## Arquivos proibidos

- `apps/api/src/services/dashboard/**` (S02/S03 são donos)

## Contratos de saída

- Linha: `{ workspace_id uuid, day date, resolvidas int, conversoes int, conversoes_valor_cents bigint, novos_contatos int }`.
- A janela é 30 dias móveis; dias sem evento não precisam existir (o front preenche buracos).

## Definition of Done

- [ ] Migration aplica limpa em banco dev (`docker compose ... up -d` + migrate) sem erro.
- [ ] MV tem UNIQUE index e `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_daily_30d` roda.
- [ ] `GRANT SELECT ... TO hm_app` presente (defesa: a role de app lê, não a owner).
- [ ] `mv-refresh-job.ts` inclui a nova MV no array (refresh 1h/1d a cobre).
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

- MVs não suportam RLS — por isso a leitura (S02) **sempre** adiciona `WHERE workspace_id = $1`.
  Esta MV segue o mesmo contrato das MVs existentes (ver `0033_f8_mv_rls_fk.sql`).
- Não há `resolved_at` no schema; o padrão existente (`performancePorAtendente`,
  `tempoMedioResolucao24h`) usa `updated_at` para conversa resolvida — manter consistência.
