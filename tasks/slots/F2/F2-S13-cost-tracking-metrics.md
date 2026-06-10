---
id: F2-S13
title: Cost tracking + agregação de agent_metrics a partir de llm_usage_logs
phase: F2
status: in-progress
priority: medium
estimated_size: M
depends_on: [F2-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:19:24Z

---
# F2-S13 — Cost tracking + agent_metrics

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §8; `docs/features/DASHBOARD.md`; `docs/ROADMAP.md` F2-S13
> **blocks:** —

## Objetivo
Job que agrega `llm_usage_logs` em `agent_metrics` (custo/tokens/execuções por agente, por dia/mês) para alimentar dashboards e os caps. Roll-up idempotente, scheduler-friendly.

## Escopo (faz)
- `apps/workers/src/agents/metrics.ts`: agregação periódica de `llm_usage_logs` → upsert em `agent_metrics` (por workspace/agent/dia), sob RLS; idempotente (re-run não duplica).

## Fora de escopo
- Schema (F2-S01 cria `agent_metrics`/`llm_usage_logs`); UI de métricas (F2-S18 tab Metrics / F2.5-S05); hard cap (F2-S09).

## Arquivos permitidos
- `apps/workers/src/agents/metrics.ts`

## Definition of Done
- [ ] Roll-up idempotente de usage → `agent_metrics`; números batem com a soma bruta.
- [ ] Registrado no scheduler (reporta wiring p/ o bootstrap de workers).
- [ ] `pnpm --filter @hm/workers typecheck`/lint/test verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
Fonte de verdade do custo é `llm_usage_logs` (gravado no finalize de F2-S05). `agent_metrics` é cache agregado.
