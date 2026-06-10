---
id: F2-S09
title: Hard cap de custo no Node antes da chamada ao runtime
phase: F2
status: in-progress
priority: high
estimated_size: S
depends_on: [F2-S01, F2-S03]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:33:50Z

---
# F2-S09 — Hard cap de custo (pre-call, Node)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §8.1; `docs/ROADMAP.md` F2-S09
> **blocks:** F2-S11

## Objetivo
Antes de chamar o `agent-runtime`, o Node verifica o teto de custo: `policy.max_monthly_cost_usd - sum(llm_usage_logs do mês) > custo_estimado`. Se exceder, bloqueia a execução (não chama o runtime) e registra o motivo.

## Escopo (faz)
- `apps/api/src/agents/cost-guard.ts`: `assertWithinBudget({ workspaceId, policy, estimatedCostUsd })` — soma `llm_usage_logs` do mês corrente (RLS), compara com `max_monthly_cost_usd`, retorna ok/blocked + headroom. Estimativa de custo a partir do modelo + tokens previstos.
- `apps/api/src/agents/policy-resolver.ts`: monta o `policy_snapshot` a partir de `workspace_agent_policies` (allowed_models/tools, caps, max_iterations) para enviar ao runtime.

## Fora de escopo
- Enforcement no runtime (F2-S08), agregação/dashboards de custo (F2-S13/F2.5-S05), a chamada em si (F2-S11).

## Arquivos permitidos
- `apps/api/src/agents/cost-guard.ts`
- `apps/api/src/agents/policy-resolver.ts`

## Definition of Done
- [ ] Soma de `llm_usage_logs` do mês sob RLS; bloqueia quando estouraria o cap.
- [ ] `policy-resolver` produz o snapshot consumido por F2-S08.
- [ ] `pnpm --filter @hm/api typecheck`/lint/test verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Custo estimado é conservador (limite superior) — melhor bloquear de leve a mais do que estourar o cap do workspace.
