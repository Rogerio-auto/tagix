---
id: F56-S01
title: Runtime IA — coluna fantasma vision + clamp de tokens + latency_ms
phase: F56
status: available
priority: critical
estimated_size: S
depends_on: []
blocks: []
agent_id: python-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S01 — Runtime IA: destravar execução real (AG-01/AG-02/AG-07)

> **Origem:** AUDITORIA_TECNICA.md §3.3. O runtime Python não responde contra o schema real: `load_context` faz `SELECT model_supports_vision` de uma coluna inexistente (a real é `vision_model`). É o P0 mais crítico do produto.

## Objetivo

Fazer o runtime de agentes responder ponta-a-ponta contra o Postgres real, corrigindo a coluna fantasma, impondo o teto de tokens da policy e gravando a latência.

## Contexto / causa raiz (verificada)

- **AG-01:** `apps/agent-runtime/app/nodes/load_context.py:71` seleciona `COALESCE(model_supports_vision, false)`; a tabela `agents` só tem `vision_model` (`0014_agents_schema.sql`). `asyncpg` levanta `UndefinedColumnError` no **primeiro nó** do grafo → nenhum agente responde. Testes usam pool fake, por isso não pegaram.
- **AG-02:** `call_model.py:105` usa `setdefault("max_tokens", policy.max_tokens_per_call)` — só aplica o teto quando ausente; `maxTokens` do agente (até 200k) burla o cap do workspace.
- **AG-07:** `finalize.py` insere em `llm_usage_logs` **sem** `latency_ms`; `avg_latency_ms` do roll-up é sempre nulo.

## Escopo (faz)

- Trocar o SELECT por `COALESCE((vision_model IS NOT NULL), false) AS model_supports_vision` (ou remover o campo, se ninguém a jusante consome).
- `call_model`: `model_params["max_tokens"] = min(model_params.get("max_tokens", inf), policy.max_tokens_per_call)`.
- `call_model`/`finalize`: medir wall-time da chamada ao modelo, propagar no state, gravar `latency_ms` no INSERT de `llm_usage_logs`.
- **Teste de integração** de `load_context` contra o schema real (fixture com a tabela `agents` real), que teria pegado AG-01.

## Escopo (não faz)

- Anti-prompt-injection / moderação (F56-S11, mesmo diretório, arquivo `build_prompt.py` — disjunto).
- Versionamento de prompt (F56-S30).

## Arquivos permitidos

- `apps/agent-runtime/app/nodes/load_context.py`
- `apps/agent-runtime/app/nodes/call_model.py`
- `apps/agent-runtime/app/nodes/finalize.py`
- `apps/agent-runtime/tests/test_load_context.py`
- `apps/agent-runtime/tests/test_call_model.py`
- `apps/agent-runtime/tests/test_finalize.py`

## Arquivos proibidos

- `apps/agent-runtime/app/nodes/build_prompt.py` (F56-S11)
- `apps/agent-runtime/tests/test_guardrails.py` · `apps/agent-runtime/tests/test_build_prompt.py` (F56-S11)

## Definition of Done

- [ ] `load_context` executa sem erro contra o schema real (teste de integração verde).
- [ ] Agente com `maxTokens=200000` respeita `max_tokens_per_call` do workspace (teste).
- [ ] `llm_usage_logs.latency_ms` é gravado > 0 numa execução real.
- [ ] `uv run pytest` verde.

## Validação

```bash
cd apps/agent-runtime && uv run pytest
```

## Notas

- Ninguém a jusante consome `model_supports_vision` além do gate de vision — remover é aceitável, mas manter a coluna derivada é mais seguro para compat.
- Adicionar o teste de integração de `load_context` é DoD: ele é a rede que faltou.
