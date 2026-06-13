---
id: F29-S02
title: LLM-judge no agent-runtime — POST /internal/evaluate
phase: F29
status: available
priority: high
estimated_size: M
depends_on: []
agent_id: python-engineer
source_docs:
  - docs/features/AGENT_QUALITY_OBJECTIONS.md
  - docs/AGENTS_LANGGRAPH.md
---

# F29-S02 — LLM-judge (agent-runtime)

> **source_docs:** `docs/features/AGENT_QUALITY_OBJECTIONS.md` §2; `docs/AGENTS_LANGGRAPH.md`
> **blocks:** F29-S03

## Objetivo

Endpoint interno no agent-runtime que avalia uma conversa encerrada e retorna JSON estruturado: `quality_score`, `quality_rationale`, `sentiment_score`, `csat_label`, `handled_by`, e lista de `objections` (categoria/label/excerpt/resolved). Usa OpenRouter (modelo judge barato, configurável) e loga o custo em `llm_usage_logs(request_type='evaluation')`.

## Contexto

Mesma arquitetura do `/internal/embed` (F3-S02): rota FastAPI autenticada por `Bearer AGENT_RUNTIME_TOKEN`, acesso a DB sob RLS via `with_workspace`. O Node (F29-S03) só dispara e persiste o retorno — toda a inteligência do judge fica aqui.

## Escopo (faz)

- `apps/agent-runtime/app/routes/evaluate.py` (novo): `POST /internal/evaluate`, body `{ workspace_id: uuid, conversation_id: uuid }`. Busca as mensagens da conversa sob RLS (`with_workspace`), monta o transcript, chama o judge.
- `apps/agent-runtime/app/evaluation/__init__.py` + `judge.py` (novo): prompt estruturado (vocabulário de objeção fixo §2), chamada ao provider OpenRouter (`temperature` baixa + JSON mode), parser Pydantic com validação dura (saída inválida → erro tratado, sem retorno parcial).
- `apps/agent-runtime/app/config.py` (editar): setting `judge_model` (env, default um modelo pequeno do OpenRouter).
- `apps/agent-runtime/app/main.py` (editar): `include_router(evaluate_router)`.
- Loga `llm_usage_logs(request_type='evaluation', router='openrouter', model=judge_model, cost_usd=...)` best-effort sob RLS (padrão `_log_usage` do embed).
- `apps/agent-runtime/tests/test_evaluate.py` (novo): smoke do contrato (mock do provider) + parser rejeita JSON inválido + auth 401.

## Fora de escopo

- Schema/persistência das tabelas (F29-S01/S03 — este endpoint **não escreve** `conversation_evaluations`/`objections`, só retorna o JSON).
- Worker/gatilho (F29-S03). Dashboard (F29-S04/S05).

## Arquivos permitidos

- `apps/agent-runtime/app/routes/evaluate.py`
- `apps/agent-runtime/app/evaluation/**`
- `apps/agent-runtime/app/config.py`
- `apps/agent-runtime/app/main.py`
- `apps/agent-runtime/tests/test_evaluate.py`

## Arquivos proibidos

- `packages/db/**`, `apps/api/**`, `apps/web/**`, `apps/workers/**`.
- Demais rotas/nós do agent-runtime (`routes/run.py`, `graph.py`, etc.).

## Contratos de saída

- `200`: JSON exatamente no shape do §2 do doc (consumido por F29-S03 para persistir). `temperature` baixa; objeções com `category` no vocab controlado.
- `401` token inválido; `400` body inválido; `422`/`502` quando o judge devolve saída inválida ou o upstream falha.

## Definition of Done

- [ ] `/internal/evaluate` retorna o JSON do §2 validado por Pydantic; saída inválida do LLM nunca vira retorno parcial.
- [ ] `judge_model` configurável por env; custo logado em `llm_usage_logs(request_type='evaluation')` sob RLS.
- [ ] Auth `Bearer` obrigatória (401 sem token); messages lidas sob `with_workspace` (RLS).
- [ ] `ruff check` + `pytest` verdes.

## Validação

```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas

- Especialista: **python-engineer**. Espelhe `routes/embed.py` (auth, `_log_usage`, provider via `request.app.state`).
- Reusa o provider OpenRouter existente (`app/providers/openrouter.py`). Sem novo SDK.
