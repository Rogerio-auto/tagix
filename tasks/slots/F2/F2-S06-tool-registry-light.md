---
id: F2-S06
title: Tool registry + tools "leves" (query_contact/conversation/search_kb) via asyncpg RLS
phase: F2
status: blocked
priority: high
estimated_size: M
depends_on: [F2-S02, F2-S01, F2-S10]
---

# F2-S06 — Tool registry + tools leves

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §6.1, §6.2, §7.1; `docs/ROADMAP.md` F2-S06
> **blocks:** F2-S07, F2-S20

## Objetivo
Infra de tools do runtime: classe base `Tool` (schema OpenAI a partir de Pydantic), `registry` (resolve tools por key, expõe specs para o `call_model`), e as tools "leves" que executam direto em Python via asyncpg sob contexto de workspace (RLS): `query_contact`, `query_conversation`, `search_knowledge_base` (stub até F3).

## Escopo (faz)
- `app/tools/base.py`: `Tool` ABC + geração de schema OpenAI a partir do Pydantic args model + execução com column-access (usa `app/tools/access_control.py` de F2-S10).
- `app/tools/registry.py`: registro/resolução de tools, listagem de specs filtrada por policy (interface p/ F2-S08).
- `app/tools/database/**`: `query_contact.py`, `query_conversation.py`, `search_knowledge_base.py` (asyncpg + `with_workspace`).

## Fora de escopo
- Tools de negócio via callback Node (F2-S07), workflow modular + register_conversion (F2-S20), módulo de column-access (F2-S10).

## Arquivos permitidos
- `apps/agent-runtime/app/tools/base.py`
- `apps/agent-runtime/app/tools/registry.py`
- `apps/agent-runtime/app/tools/database/**`

## Definition of Done
- [ ] `registry` resolve tools por key e gera specs OpenAI válidos.
- [ ] Tools de DB consultam sob RLS (`with_workspace`) e aplicam column-access (F2-S10).
- [ ] `ruff` + `pytest` (asyncpg mockado) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
A interface `Tool` é o contrato para F2-S07 (callback) e F2-S20 (workflow). Fixe-a aqui.
