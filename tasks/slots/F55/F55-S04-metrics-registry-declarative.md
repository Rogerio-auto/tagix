---
id: F55-S04
title: Registry declarativo de métricas (mata o switch de resolveValue) + queries SLA/TTR exatas
phase: F55
status: available
priority: critical
estimated_size: L
depends_on: [F55-S01]
blocks: [F55-S05, F55-S06, F55-S08]
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/features/PERMISSIONS.md
---
# F55-S04 — Registry declarativo de métricas

## Objetivo

Substituir o `switch` gigante de `resolveValue()` (~100 linhas em `load-dashboard.ts`) e a separação
definição↔query↔drill (3 arquivos) por **um módulo auto-contido por métrica**: cada métrica declara sua
definição + resolve + drill no mesmo lugar, e um registry tipado agrega tudo num `Map`. Mantém **100% o
contrato externo** (`/api/dashboard/me`, `/metrics/:key`) — só as tripas mudam. Atualiza as queries de
SLA/TTR/TMR para usar os timestamps reais (S01).

## Contexto

Ponto de dor #1 declarado pelo founder: todo card novo toca 4 arquivos (`definitions.ts`, `queries.ts`,
`load-dashboard.ts`, `drill-down.ts`). `loadDashboard` chama `metricsForRole(role).map(resolveValue)`; o
`resolveValue` é o switch. `definitions.ts` já tem o tipo `MetricDefinition` rico (key/label/category/
roles/cadence/scope/cardType/drillHref/requiresConversionType) e os atalhos de role (AGENT_UP/SUP_UP/...).
O contrato server-driven role-aware é correto e **fica** — anti-padrão é o front fazer `if(role)`.

## Escopo

### files_allowed
- `apps/api/src/services/dashboard/**` (dono do diretório inteiro do serviço)
- `apps/api/src/routes/dashboard/**`
- `apps/api/src/services/dashboard/__tests__/**`

### files_forbidden
- `packages/db/**`, `apps/web/**`, `apps/workers/**`, `apps/api/src/routes/conversations/**` (S02),
  `apps/api/src/internal/**` (S02)

## Escopo (faz)
- Criar `metrics/` com:
  - `types.ts`: `MetricModule = { def: MetricDefinition; resolve(ctx: MetricCtx): Promise<MetricValue|null>; drill?(ctx, params): Promise<DrillResult|null> }`. `MetricCtx = { tx, workspaceId, memberId, role, scope }`.
  - `registry.ts`: importa todos os módulos → `Map<key, MetricModule>`; expõe `metricsForRole(role, hasConversionType)` e `visibleMetricKeys(role)` (porta o comportamento atual de `definitions.ts`).
  - Subpastas por categoria (`atendimento/ pipeline/ conversoes/ agentes/ negocio/`), **um arquivo por métrica** já existente, co-locando def + resolve + (drill quando houver). As funções SQL podem permanecer importadas de `queries.ts` (lib de helpers) OU migrar para o módulo — preferir manter `queries.ts` como lib pura e o módulo só orquestrar (menos churn).
- Encolher `load-dashboard.ts`: `resolveValue` vira `registry.get(m.key)?.resolve(ctx) ?? null` — **zero switch**. `loadDashboard` mantém shape de retorno (`DashboardPayload`).
- `drill-down.ts`: `drillDown` passa a despachar via `registry.get(key)?.drill(ctx, params)`, **preservando** a autorização por role (`metricVisibleTo` → 403) e a allowlist de objeções.
- `definitions.ts`: ou removido (conteúdo migrado para os módulos) ou reduzido a re-exports de tipo — sem duplicar a fonte da verdade.
- **Queries exatas (usando S01):** atualizar `tempo_medio_resolucao_24h` para `closed_at/resolved_at − created_at`, `tempo_medio_primeira_resposta_24h` para usar `first_response_at`, e `sla_violado_hoje` para comparar `first_response_at`/`resolved_at` vs `sla_rules` — em vez de varrer `messages`.
- Manter `alerts.ts`, `emit.ts` (emit fica órfão ainda — wiring é S08).

## Fora de escopo
- Cards/métricas NOVOS (S05). Frontend (S06/S07). Wiring de emit (S08). Schema/MV (S01/S03).

## Contratos de entrada/saída
- `/api/dashboard/me`, `/api/dashboard/metrics/:key`, `/config`, `PATCH .../dashboard-layout`: **shape externo idêntico** (o front atual continua funcionando durante a transição).
- `registry.get(key)`, `metricsForRole`, `visibleMetricKeys` exportados de `metrics/registry.ts` para S05 registrar novos módulos.

## Permission scope
Toda a matriz de roles (`PERMISSIONS.md §1` hierarquia aditiva) preservada: o registry filtra por role no
servidor; drill re-checa visibilidade (403). Nenhum card de role não-autorizado pode vazar no payload.

## Definition of Done
- [ ] `resolveValue` não tem mais `switch` por key; dispatch 100% via registry.
- [ ] Cada métrica existente é um módulo auto-contido; adicionar card = adicionar 1 arquivo + 1 registro.
- [ ] Contrato de `/api/dashboard/*` inalterado (testes de contrato existentes verdes; payload idêntico para cada role).
- [ ] SLA/TTR/TMR leem os timestamps de S01 (não mais varredura de `messages`).
- [ ] Teste: cada role vê exatamente o conjunto de keys esperado (portar de `visibleMetricKeys`/testes atuais).
- [ ] `pnpm typecheck`, `pnpm lint` (zero `any`), `pnpm --filter @hm/api test` verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Refactor grande mas **comportamento-preservador** por design — é a razão de o contrato congelar aqui e
liberar S05 (cards novos) e S06 (frontend) em paralelo. Não reabrir a decisão server-driven. `emit.ts`
continua sem caller ao fim deste slot (intencional; S08 liga).
