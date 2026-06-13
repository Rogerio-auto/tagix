---
id: F28-S01
title: Dashboard Onda A — métricas backend (performance atendente, rankings, IA ops)
phase: F28
status: available
priority: high
estimated_size: L
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
---

# F28-S01 — Dashboard Onda A (backend)

> **source_docs:** `docs/features/DASHBOARD.md` §2.1, §2.4, §2.5, §3.2
> **blocks:** F28-S02

## Objetivo

Implementar no dashboard server-driven as métricas que o `DASHBOARD.md` já especifica mas pararam no MVP, com foco no que o fundador pediu: **performance isolada por atendente**, **ranking de conversões por atendente humano e por agente IA**, e **métricas operacionais dos agentes de IA**. Tudo via query viva/snapshot sobre tabelas existentes — **sem alterar `packages/db`** (parallel-safe com a F26).

## Contexto

O dashboard é server-driven: `services/dashboard/definitions.ts` declara as métricas (role/categoria/cadência/cardType), `queries.ts` computa o valor e `load-dashboard.ts:resolveValue` faz o wiring. Hoje há ~18 métricas MVP; faltam as de supervisão/IA. O frontend (F28-S02) renderiza por `cardType` automaticamente assim que o card chega no payload.

## Escopo (faz)

Adicionar as métricas abaixo em `definitions.ts` + query em `queries.ts` + `case` em `resolveValue`:

**Atendimento / performance (§2.1, §3.2):**
- `performance_por_atendente` — `table` (SUP_RO): por member atribuído → `{ memberId, nome, abertas, resolvidas_hoje, tempo_medio_resposta_seg, sla_status }`. Payload com `columns` + `rows` (contrato p/ TableCard column-aware do S02).
- `tempo_medio_primeira_resposta_24h` — `stat` (AGENT minha / SUP team / ADMIN ws).
- `tempo_medio_resolucao_24h` — `stat` (SUP_RO).
- `inbox_por_canal` — `table` (SUP_RO): GROUP BY channel.provider, status.
- `transferencias_24h` — `stat` (SUP/ADMIN): conversation_routing_history últimas 24h.

**Agentes IA — operacional (§2.4):**
- `agente_handoffs_24h`, `agente_resolucoes_24h` — `stat` (SUP/ADMIN): de tool_logs/executions.
- `latencia_agente_p95_24h` — `stat` (ADMIN): agregada de agent_executions (live, janela 24h).
- `tokens_por_modelo_24h` — `table` (ADMIN): llm_usage_logs GROUP BY model.
- `cap_mensal_consumido_pct` — `stat` (ADMIN/OWNER) + **alerta** em `alerts.ts` quando ≥ 80% (`warning`) / ≥ 100% (`critical`).

**Conversões — ranking (§2.5):**
- `conversoes_por_atendente_humano` — `table` (SUP_UP): conversion_events GROUP BY triggered_by_member_id (ranking, top performer). Drill-down `/conversions?member_id=<id>&period=mes`.
- `conversoes_por_agente_ia` — `table` (SUP_UP): GROUP BY triggered_by_agent_id.

- Estender `drill-down.ts` para os novos `table` que abrem drawer (performance, rankings) com detalhe expandido.

## Fora de escopo

- Frontend / cards (F28-S02).
- **Qualquer materialized view nova ou mudança em `packages/db`** — métricas saem de query viva/snapshot (otimização MV é deferida, depende de F26-S01 mergear).
- Onda B (qualidade de resposta / CSAT / objeções — F29).
- Worker/scheduler de snapshot (métricas novas computam live no load; sem editar `apps/workers`).

## Arquivos permitidos

- `apps/api/src/services/dashboard/**`
- `apps/api/src/routes/dashboard/**`

## Arquivos proibidos

- `packages/db/**` (zona F26-S01 + decisão de não tocar schema nesta onda)
- `apps/api/src/routes/platform/**`, `apps/api/src/services/platform/**` (zona F26)
- `apps/web/**` (F28-S02)
- `apps/workers/**`

## Contratos de saída

- Cards `table` novos retornam `value: { columns: {key,label,align?}[], rows: Record<string,unknown>[] }` — contrato consumido pelo TableCard column-aware (F28-S02). Cards `stat` retornam `{ value, unit?, delta? }` no formato já existente.
- Keys de métrica novas estáveis (acima) — F28-S02 referencia por key.

## Definition of Done

- [ ] Todas as métricas listadas declaradas em `definitions.ts` (role/categoria/cadência/cardType corretos) + query real + `case` em `resolveValue`.
- [ ] `performance_por_atendente` e rankings retornam `{columns, rows}`; drill-down detalhado disponível.
- [ ] `cap_mensal_consumido_pct` dispara alerta em `alerts.ts` (≥80% warning / ≥100% critical).
- [ ] Filtragem por role respeitada (anti-padrão §10: nenhum card de role não autorizado vaza); escopo team vs workspace correto.
- [ ] Diff restrito a `services/dashboard` + `routes/dashboard`; **zero** mudança em `packages/db`.
- [ ] `pnpm typecheck` + `pnpm lint` verdes; teste de `load-dashboard` cobrindo visibilidade por role das novas métricas.

## Permission scope

- Métricas de supervisão/IA: `SUPERVISOR`/`ADMIN`/`OWNER`/`READONLY` conforme `DASHBOARD.md §2` (READONLY vê informativo sem ação). AGENT vê só a versão `personal` (sua média). Sem vazamento de métrica pessoal de outro member fora do team (§10).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Reusa helpers de `queries.ts` (janelas, snapshot fallback). Latência p95 e volumes: live na janela 24h — aceitável p/ MVP; **otimização para materialized view fica deferida** (slot futuro, depende de F26-S01 done, para não brigar com a migration em voo).
- **Paralelismo:** `services/dashboard` e `routes/dashboard` são disjuntos da F26 (que está em `platform/**` e `packages/db`).
