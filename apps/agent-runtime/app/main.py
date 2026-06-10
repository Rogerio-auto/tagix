"""Entrypoint FastAPI do agent-runtime.

Esqueleto do microsserviço (F2-S02): app + lifespan (pool asyncpg), logging
estruturado com redação de PII, CORS interno, healthcheck. O grafo LangGraph,
o OpenRouter provider, as tools e a policy enforcement entram em slots
posteriores (F2-S04/S05/S06/S08) — `/run` é placeholder aqui.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.checkpoint import lifespan_checkpointer
from app.config import get_settings
from app.db import close_pool, get_pool, init_pool
from app.graph import build_graph
from app.health import router as health_router
from app.logging import configure_logging, get_logger
from app.providers import OpenRouterProvider
from app.providers.embeddings import EmbeddingsProvider
from app.routes import run_router
from app.routes.embed import router as embed_router
from app.tools.registry import build_default_registry
from app.tools.workflow import register_workflow_tools


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup: pool asyncpg + registry de tools (leves + workflow callback) +
    checkpointer + grafo compilado (publicado em `app.state.graph` para `/run`).
    Shutdown: fecha tudo (provider, http client de callback, pool)."""
    settings = get_settings()
    configure_logging(level=settings.log_level, json_logs=settings.log_json)
    logger = get_logger()

    await init_pool()
    # Cliente HTTP compartilhado dos callbacks de business tools (F2-S07/S20);
    # o lifespan é dono e o fecha no shutdown.
    http_client = httpx.AsyncClient(timeout=15.0)
    registry = build_default_registry(get_pool(), http_client=http_client)
    register_workflow_tools(registry, http_client)
    async with lifespan_checkpointer() as checkpointer:
        provider = OpenRouterProvider()
        # Provider de embeddings (OpenAI direto) compartilhado por /internal/embed (F3-S02).
        embeddings_provider = EmbeddingsProvider()
        app.state.embeddings_provider = embeddings_provider
        app.state.graph = build_graph(
            tool_registry=registry,
            checkpointer=checkpointer,
            provider=provider,
        )
        logger.info("agent-runtime up (version={})", __version__)
        try:
            yield
        finally:
            await provider.aclose()
            await embeddings_provider.aclose()
            await http_client.aclose()
            await close_pool()
            logger.info("agent-runtime down")


def create_app() -> FastAPI:
    """Factory do app FastAPI (facilita override em testes)."""
    settings = get_settings()
    app = FastAPI(
        title="hm-agent-runtime",
        version=__version__,
        lifespan=lifespan,
    )

    # CORS interno: só as origens declaradas (Node API) podem chamar o runtime.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allow_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(health_router)
    app.include_router(run_router)
    app.include_router(embed_router)

    return app


app = create_app()
