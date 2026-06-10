"""Healthcheck do agent-runtime.

`GET /health` faz um ping real no Postgres (`SELECT 1`). Retorna 200 quando o
processo está vivo E o banco responde; 503 quando o banco está inacessível.
Consumido pelo HEALTHCHECK do Docker e pelos checks de orquestração do stack.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app import __version__
from app.db import ping
from app.logging import get_logger

logger = get_logger()

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(response: Response) -> dict[str, str]:
    """Liveness + readiness do banco. 200 se DB responde, 503 caso contrário."""
    try:
        db_ok = await ping()
    except Exception as exc:  # noqa: BLE001 - degradamos qualquer falha de DB para 503
        logger.warning("healthcheck: ping ao banco falhou: {}", type(exc).__name__)
        db_ok = False

    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unhealthy", "version": __version__, "database": "down"}

    return {"status": "ok", "version": __version__, "database": "up"}
