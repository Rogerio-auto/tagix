"""Entrypoint FastAPI do agent-runtime.

F2-S02 expande este serviço: graph LangGraph, PostgresSaver, tool registry,
policy enforcement. Por ora expõe o healthcheck que o restante do stack consulta.
"""

from __future__ import annotations

from fastapi import FastAPI

from app import __version__

app = FastAPI(title="hm-agent-runtime", version=__version__)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
