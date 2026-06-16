---
id: F34-S06
title: Runtime — tool transfer_to_agent, diretriz de prompt e contexto IA→IA
phase: F34
status: blocked
priority: medium
estimated_size: M
depends_on:
  - F34-S01
  - F34-S05
blocks:
  - F34-S07
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
  - docs/AGENTS_LANGGRAPH.md
agent_id: python-engineer
---
# F34-S06 — Runtime: prompt + handoff IA→IA

## Objetivo

No agent-runtime: expor a tool `transfer_to_agent` ao LLM, injetar no system prompt a diretriz de quando transferir + a lista de pares disponíveis (quando `allow_handoff`), e generalizar o contexto de handoff para também rotular turnos de **outro agente de IA** (hoje só rotula humano).

## Contexto

As tools do runtime ficam em `apps/agent-runtime/app/tools/workflow/` (ex.: `transfer_to_human.py`, `escalate.py`, registradas em `__init__.py`); chamam de volta o Node via `callback.py`. A montagem do prompt + rotulagem de autoria está em `app/nodes/build_prompt.py` e `app/nodes/load_context.py` (hoje cobrem só IA→humano — ver `tests/test_handoff_context.py`). O contrato de args vem de S05: `transfer_to_agent({ targetAgentId, reason? })`.

## Escopo (faz)

- **`apps/agent-runtime/app/tools/workflow/transfer_to_agent.py`** (novo) — definição da tool (schema de args = contrato S05) + chamada via `callback` para `transfer_to_agent`. Espelhar `transfer_to_human.py`.
- **`apps/agent-runtime/app/tools/workflow/__init__.py`** — registrar a tool; expô-la apenas quando o agente tem `allow_handoff=true` e ≥1 par disponível.
- **`apps/agent-runtime/app/nodes/build_prompt.py`** — quando `allow_handoff`, injetar diretriz de transferência + lista de pares (nome + departamento + 1 linha de "quando usar"); generalizar a rotulagem de histórico para incluir `[Outro agente de IA] …` além de `[Atendente humano]`.
- **`apps/agent-runtime/app/nodes/load_context.py`** — rotular autoria de turnos de outro agente de IA (distinguir do agente atual) para alimentar o prompt.
- **`apps/agent-runtime/tests/`** — testes: tool presente só com `allow_handoff` + pares; diretriz + pares no prompt; histórico rotula turno de outro agente de IA; sem regressão no fluxo IA→humano existente.

## Fora de escopo

- Handler Node + authz + re-engaje (S05).
- Schema/repo (S01).
- UI (S02/S04).

## Arquivos permitidos

- `apps/agent-runtime/app/tools/workflow/transfer_to_agent.py`
- `apps/agent-runtime/app/tools/workflow/__init__.py`
- `apps/agent-runtime/app/nodes/build_prompt.py`
- `apps/agent-runtime/app/nodes/load_context.py`
- `apps/agent-runtime/tests/**`

## Arquivos proibidos

- `apps/agent-runtime/app/tools/workflow/transfer_to_human.py`
- `apps/api/**`
- `packages/**`

## Contratos de entrada/saída

- Consome o contrato de args de S05 (`transfer_to_agent({ targetAgentId, reason? })`) — deve casar exatamente.
- A lista de pares disponíveis vem do contexto carregado (pares = agentes que compartilham departamento; fornecidos ao prompt via load_context / request).

## Definition of Done

- [ ] `transfer_to_agent` disponível ao LLM só quando `allow_handoff=true` e há ≥1 par.
- [ ] System prompt traz a diretriz + a lista de pares (nome/dept/quando) quando aplicável; ausência total quando não aplicável (sem regressão).
- [ ] Histórico rotula turnos de outro agente de IA distintamente do agente atual e do humano.
- [ ] Suíte do runtime verde (`uv run pytest`), incl. os testes de handoff existentes.

## Notas

A fonte dos "pares disponíveis" deve vir do contexto já carregado pelo runtime (não fazer query nova de DB dentro do prompt). Se o request/loadContext ainda não traz a lista de pares, estender o contexto carregado para incluí-la (dentro dos arquivos permitidos). Manter a diretriz curta e acionável — o LLM decide; o limite de iterações (`max_iterations` da policy) e a authz de alvo da S05 contêm abuso/loop.
