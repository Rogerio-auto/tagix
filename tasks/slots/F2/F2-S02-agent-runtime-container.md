---
id: F2-S02
title: Container agent-runtime (FastAPI + LangGraph + LangServe + asyncpg) + logging
phase: F2
status: available
priority: critical
estimated_size: M
depends_on: []
---

# F2-S02 — Container agent-runtime (bootstrap)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §2, §3.5; `docs/ARCHITECTURE.md` ADR-023; `docs/ROADMAP.md` F2-S02
> **blocks:** F2-S03, F2-S04, F2-S05, F2-S06, F2-S07, F2-S08, F2-S10

## Objetivo
Esqueleto de processo do microsserviço Python `agent-runtime`: FastAPI app + uvicorn, dependências (langgraph, langserve, httpx, asyncpg, pydantic), pool asyncpg, healthcheck, logging estruturado (loguru com redação de PII), Dockerfile + healthcheck. Base sobre a qual os nodes/tools/providers são montados.

## Escopo (faz)
- `pyproject.toml`: adicionar `langgraph`, `langserve`, `asyncpg`, `psycopg[binary]` (checkpointer), `langchain-core` (deps do graph); dev: `pytest`, `ruff`.
- `app/main.py`: FastAPI app, montagem de rotas (placeholder p/ `/run`), startup/shutdown (pool asyncpg), CORS interno.
- `app/config.py`: settings (DATABASE_URL, OPENROUTER_API_KEY, INTERNAL_TOOL_TOKEN, API_BASE_URL) via env (pydantic-settings).
- `app/db.py`: pool asyncpg + helper `with_workspace(conn, workspace_id)` (SET LOCAL role/`app.workspace_id`).
- `app/logging.py`: loguru configurado + filtro de redação de PII (telefone/email/tokens).
- `app/health.py`: `GET /health` (DB ping).
- `Dockerfile` (python:3.13-slim + uv) + `.dockerignore` + HEALTHCHECK.

## Fora de escopo
- OpenRouter provider (F2-S04), graph/nodes (F2-S05), tools (F2-S06/S07), policy (F2-S08).

## Arquivos permitidos
- `apps/agent-runtime/pyproject.toml`
- `apps/agent-runtime/Dockerfile`
- `apps/agent-runtime/.dockerignore`
- `apps/agent-runtime/app/main.py`
- `apps/agent-runtime/app/config.py`
- `apps/agent-runtime/app/db.py`
- `apps/agent-runtime/app/logging.py`
- `apps/agent-runtime/app/health.py`

## Definition of Done
- [ ] `uv sync` instala as deps; app sobe (`uvicorn app.main:app`) e `/health` retorna 200 com DB ping.
- [ ] Logs estruturados com PII redigido (telefone/email/token nunca em claro).
- [ ] `docker build` ok; HEALTHCHECK definido.
- [ ] `ruff check` + `pytest` (smoke do /health) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
Pool asyncpg + `with_workspace` é a fundação RLS das tools "leves" (F2-S06). Manter `app/db.py` enxuto — o checkpointer Postgres (F2-S05) usa conexão própria (psycopg).
