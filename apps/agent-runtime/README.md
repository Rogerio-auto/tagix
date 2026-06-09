# agent-runtime

Microsserviço Python de agentes IA do Highermind v2 (FastAPI + LangGraph + OpenRouter).

## Rodar em dev (Windows, requer `uv` — vide `docs/runbooks/dev-environment-windows.md` §4)

```powershell
PS> uv sync
PS> uv run uvicorn app.main:app --reload --port 8001
PS> curl http://localhost:8001/healthz
```

## Estrutura

- `app/main.py` — entrypoint FastAPI (healthcheck; graph entra em F2).
- `app/config.py` — settings a partir do ambiente (fail-fast).

> Skeleton da fase F0. O runtime completo (graph LangGraph, PostgresSaver, tools,
> policy enforcement) é materializado na fase **F2** do `docs/ROADMAP.md`.
