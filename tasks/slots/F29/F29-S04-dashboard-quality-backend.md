---
id: F29-S04
title: Dashboard Onda B — métricas backend (qualidade, CSAT, objeções)
phase: F29
status: done
priority: high
estimated_size: M
depends_on: [F29-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/AGENT_QUALITY_OBJECTIONS.md
  - docs/features/DASHBOARD.md
claimed_at: 2026-06-13T16:37:44Z
completed_at: 2026-06-13T16:42:32Z

---
# F29-S04 — Dashboard Onda B (backend)

> **source_docs:** `docs/features/AGENT_QUALITY_OBJECTIONS.md` §5; `docs/features/DASHBOARD.md`
> **blocks:** F29-S05

## Objetivo

Expor no dashboard server-driven as métricas qualitativas da Onda B a partir de `conversation_evaluations` e `objections`: qualidade média (e por agente/atendente), satisfação (CSAT) e **objeções rankeadas** com drill-down.

## Contexto

Mesmo mecanismo da Onda A (F28-S01): `definitions.ts` declara, `queries.ts` computa, `load-dashboard.ts:resolveValue` faz o wiring, `drill-down.ts` detalha. Depende só do schema (F29-S01) para query — a população dos dados (F29-S03) é runtime, não dependência de build.

## Escopo (faz)

Adicionar em `services/dashboard`:
- `qualidade_resposta_media` — `stat` (SUP_RO): avg(quality_score) 30d.
- `qualidade_por_agente` — `table` (SUP/ADMIN): avg(quality_score) GROUP BY agent_id (`{columns, rows}`, contrato do TableCard).
- `qualidade_por_atendente` — `table` (SUP/ADMIN): avg(quality_score) GROUP BY primary_member_id.
- `satisfacao_media` — `stat` (SUP_RO): avg(sentiment) + distribuição promoter/neutral/detractor 30d.
- `objecoes_rankeadas` — `table` (SUP_UP): objections GROUP BY category → count + %resolvida, top N. Drill-down (drawer) com exemplos (`excerpt`) via `drill-down.ts`.
- Categorias: qualidade→`agentes`, CSAT→`atendimento`, objeções→`negocio`. `value: null` quando sem dados (não renderiza card vazio).

## Fora de escopo

- Frontend/cards (F29-S05). Schema (F29-S01). Worker (F29-S03).
- Materialized views (query viva no MVP).

## Arquivos permitidos

- `apps/api/src/services/dashboard/**`
- `apps/api/src/routes/dashboard/**`

## Arquivos proibidos

- `packages/db/**`, `apps/web/**`, `apps/api/src/routes/platform/**`, `apps/api/src/services/platform/**`.

## Contratos de saída

- Cards `table` retornam `value: { columns, rows }` (mesmo contrato do TableCard column-aware da F28-S02). Cards `stat` no formato existente. Keys estáveis (acima) — F29-S05 referencia por key.

## Definition of Done

- [ ] As 5 métricas declaradas (role/categoria/cardType corretos) + query real + `case` em `resolveValue`; rankings retornam `{columns, rows}`.
- [ ] `objecoes_rankeadas` com drill-down (exemplos por categoria) via `drill-down.ts`.
- [ ] Filtragem por role (anti-padrão §10: nada vaza para role não autorizado).
- [ ] `value: null` sem dados (sem zero enganoso). Diff restrito a `services/dashboard` + `routes/dashboard`; zero `packages/db`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` (cobrindo visibilidade por role das novas métricas) verdes.

## Permission scope

- Qualidade/CSAT/objeções: `SUPERVISOR`/`ADMIN`/`OWNER`/`READONLY` (READONLY informativo). AGENT não vê ranking de pares (§10 — não vaza avaliação de outro atendente).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Reusa o `TableMetricValue` (`{columns, rows}`) introduzido na F28-S01.
