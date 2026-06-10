---
id: F2-S05
title: Grafo LangGraph (load_context → build_prompt → call_model → tools → finalize) + checkpointer
phase: F2
status: done
priority: critical
estimated_size: L
depends_on: [F2-S02, F2-S04, F2-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:33:55Z
completed_at: 2026-06-10T03:33:56Z

---
# F2-S05 — Build do grafo LangGraph

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §3, §4, §9; `docs/ROADMAP.md` F2-S05
> **blocks:** F2-S08, F2-S11, F2-S19, F2-S21

## Objetivo
O grafo principal do agente: `State` (TypedDict), nodes (`load_context → build_prompt → call_model → tool_dispatch → finalize`), conditional edges (loop de tools até resposta final ou `max_iterations`), checkpointer Postgres para resiliência/human-in-the-loop, e o endpoint `/run` (stream de eventos) montado no FastAPI.

## Escopo (faz)
- `app/types.py`: `AgentState` TypedDict (messages, context, tool_calls, iterations, policy_snapshot…).
- `app/nodes/**`: `load_context.py`, `build_prompt.py`, `call_model.py` (usa OpenRouterProvider), `tool_dispatch.py`, `finalize.py` (persiste `agent_executions` + `llm_usage_logs`).
- `app/checkpoint.py`: PostgresSaver/checkpointer (schema gerado).
- `app/graph.py`: monta o `StateGraph`, edges condicionais, compile com checkpointer.
- Endpoint `/run` no FastAPI (em `app/main.py`? não — manter rota em `app/routes/run.py` deste slot) que faz stream dos eventos do grafo.

## Fora de escopo
- Tools concretas (F2-S06/S07/S20), policy enforcement (F2-S08), provider interno (F2-S04 já existe).

## Arquivos permitidos
- `apps/agent-runtime/app/types.py`
- `apps/agent-runtime/app/checkpoint.py`
- `apps/agent-runtime/app/graph.py`
- `apps/agent-runtime/app/nodes/**`
- `apps/agent-runtime/app/routes/run.py`

## Definition of Done
- [ ] Grafo compila com checkpointer Postgres; `/run` faz stream de eventos (token/tool/final).
- [ ] `tool_dispatch` chama o registry de tools (interface estável p/ F2-S06/S07).
- [ ] `finalize` grava `agent_executions` + `llm_usage_logs` (via asyncpg + workspace).
- [ ] Respeita `max_iterations`; `ruff` + `pytest` (grafo com provider/tool mockados) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
O `tool_dispatch` deve consumir um registry injetável (F2-S06 popula tools "leves", F2-S07/S20 as de negócio). Definir a interface Tool aqui ou em F2-S06 e fixar o contrato.
