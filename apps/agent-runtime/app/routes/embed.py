"""Endpoint interno `POST /internal/embed` — gera embeddings + registra uso.

> **Slot:** F3-S02 — DATA_MODEL §8.2/§11. Consumido pelo worker de ingestão Node
> (F3-S03) via `fetch` com Bearer `AGENT_RUNTIME_TOKEN`.

Contrato:
  - Auth: header `Authorization: Bearer <AGENT_RUNTIME_TOKEN>` (mesmo esquema de `/run`).
  - Body: `{ workspace_id: uuid, texts: string[] }`.
  - 200: `{ embeddings: number[1536][], model: string, usage: { total_tokens, total_cost_usd } }`.
  - 401 sem/token inválido, 400 body inválido (validação Pydantic), 502 falha upstream OpenAI.

Grava uma linha em `llm_usage_logs(request_type='embedding', router='openai_direct')`
sob RLS do `workspace_id` (best-effort: falha de log não derruba a resposta).
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.db import get_pool, with_workspace
from app.logging import get_logger
from app.providers.embeddings import (
    EmbeddingsAuthError,
    EmbeddingsError,
    EmbeddingsProvider,
)

logger = get_logger()

router = APIRouter(tags=["embeddings"])


class EmbedRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    texts: list[str] = Field(min_length=1)


class EmbedUsage(BaseModel):
    total_tokens: int
    total_cost_usd: float


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    usage: EmbedUsage


def verify_token(authorization: Annotated[str | None, Header()] = None) -> None:
    from app.config import get_settings

    settings = get_settings()
    expected = f"Bearer {settings.agent_runtime_token}"
    if not authorization or authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing runtime token",
        )


def _get_provider(request: Request) -> EmbeddingsProvider:
    """Reusa o provider publicado no lifespan; cria um efêmero em fallback (testes)."""
    provider = getattr(request.app.state, "embeddings_provider", None)
    if provider is None:
        provider = EmbeddingsProvider()
    return provider


async def _log_usage(workspace_id: str, model: str, total_tokens: int, cost_usd: float) -> None:
    """Best-effort: grava uso de embedding em `llm_usage_logs` sob RLS."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            async with with_workspace(conn, workspace_id) as scoped:
                await scoped.execute(
                    """
                    INSERT INTO llm_usage_logs
                        (workspace_id, request_type, router, model,
                         prompt_tokens, total_tokens, cost_usd, metadata)
                    VALUES
                        ($1::uuid, 'embedding', 'openai_direct', $2,
                         $3, $3, $4, $5::jsonb)
                    """,
                    workspace_id,
                    model,
                    total_tokens,
                    cost_usd,
                    json.dumps({"source": "internal_embed"}),
                )
    except Exception as exc:  # noqa: BLE001 - log de uso é best-effort
        logger.error(
            "embed: falha ao registrar llm_usage_logs",
            error=type(exc).__name__,
            workspace_id=workspace_id,
        )


@router.post("/internal/embed", response_model=EmbedResponse)
async def embed(
    req: EmbedRequest,
    request: Request,
    _: Annotated[None, Depends(verify_token)],
) -> EmbedResponse:
    """Gera embeddings para `req.texts` e registra o uso. Auth interna obrigatória."""
    provider = _get_provider(request)
    try:
        result = await provider.embed(req.texts)
    except EmbeddingsAuthError as exc:
        logger.error("embed: auth OpenAI falhou", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="embeddings upstream auth failed",
        ) from exc
    except EmbeddingsError as exc:
        logger.error("embed: falha upstream OpenAI", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="embeddings upstream unavailable",
        ) from exc

    await _log_usage(
        req.workspace_id,
        result.model,
        result.usage.total_tokens,
        result.usage.total_cost_usd,
    )

    return EmbedResponse(
        embeddings=result.embeddings,
        model=result.model,
        usage=EmbedUsage(
            total_tokens=result.usage.total_tokens,
            total_cost_usd=result.usage.total_cost_usd,
        ),
    )
