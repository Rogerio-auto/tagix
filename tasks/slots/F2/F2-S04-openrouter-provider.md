---
id: F2-S04
title: OpenRouterProvider (chat completion + streaming + tool calls + usage capture)
phase: F2
status: done
priority: critical
estimated_size: M
depends_on: [F2-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:19:18Z
completed_at: 2026-06-10T03:19:18Z

---
# F2-S04 — OpenRouterProvider (Python)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §5; `docs/ROADMAP.md` F2-S04
> **blocks:** F2-S05

## Objetivo
Cliente Python do OpenRouter: chat completion (HTTP via httpx), streaming token-a-token, tool calling (function-calling), e captura de `openrouter_generation_id` + `upstream_provider` + usage (tokens/custo) para os `llm_usage_logs`.

## Escopo (faz)
- `app/providers/openrouter.py`: `OpenRouterProvider.chat(messages, model, tools=None, stream=False)` → resposta normalizada (content, tool_calls, usage, generation_id, upstream_provider).
- Streaming async (SSE do OpenRouter → async generator de deltas).
- Mapeamento de erros (rate limit, modelo indisponível, upstream) → exceções tipadas + retry/backoff seletivo.
- `app/providers/__init__.py` (barrel).

## Fora de escopo
- Persistência de usage (o node finalize de F2-S05 escreve `llm_usage_logs`), policy (F2-S08), embeddings/transcription (F3+).

## Arquivos permitidos
- `apps/agent-runtime/app/providers/**`

## Definition of Done
- [ ] `chat()` faz completion não-stream e stream; expõe tool_calls e usage/generation_id.
- [ ] Erros de upstream mapeados; sem `print` (usa logger com PII redact).
- [ ] `ruff check` + `pytest` (mock httpx) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
`generation_id`/`upstream_provider` são essenciais para auditoria e cost tracking (F2-S13). Não logar o conteúdo das mensagens em claro.
