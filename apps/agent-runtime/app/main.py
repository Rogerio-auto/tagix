"""Entrypoint FastAPI do agent-runtime.

Esqueleto do microsserviço (F2-S02): app + lifespan (pool asyncpg), logging
estruturado com redação de PII, CORS interno, healthcheck. O grafo LangGraph,
o OpenRouter provider, as tools e a policy enforcement entram em slots
posteriores (F2-S04/S05/S06/S08) — `/run` é placeholder aqui.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

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
from app.routes import run_router
from app.tools.registry import build_default_registry


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup: pool asyncpg + registry de tools + checkpointer + grafo compilado
    (publicado em `app.state.graph` para o endpoint `/run`). Shutdown: fecha tudo."""
    settings = get_settings()
    configure_logging(level=settings.log_level, json_logs=settings.log_json)
    logger = get_logger()

    await init_pool()
    registry = build_default_registry(get_pool())
    async with lifespan_checkpointer() as checkpointer:
        provider = OpenRouterProvider()
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

    return app


app = create_app()
