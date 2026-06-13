"""Endpoint interno `POST /internal/evaluate` — LLM-judge pos-conversa (F29-S02).

> **Doc:** docs/features/AGENT_QUALITY_OBJECTIONS.md SS2. Consumido pelo worker de
> avaliacao Node (F29-S03) via `fetch` com Bearer `AGENT_RUNTIME_TOKEN`.

Contrato:
  - Auth: header `Authorization: Bearer <AGENT_RUNTIME_TOKEN>` (mesmo esquema de /run).
  - Body: `{ workspace_id: uuid, conversation_id: uuid }`.
  - 200: o JudgeResult validado (quality_score, sentiment_score, csat_label,
    handled_by, objections[]) + `judge_model` + `judge_cost_usd`.
  - 401 sem/token invalido; 422 saida do judge invalida (nada e persistido); 502 falha upstream.

Le as mensagens sob RLS do workspace (`with_workspace`) e grava uma linha em
`llm_usage_logs(request_type='evaluation', router='openrouter')` sob o mesmo RLS
(best-effort: falha de log nao derruba a resposta). O custo do judge fica separado
do gasto de producao e do `is_test` do playground.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict

from app.config import get_settings
from app.db import get_pool, with_workspace
from app.evaluation import (
    JudgeError,
    JudgeInvalidOutputError,
    JudgeResult,
    evaluate_conversation,
)
from app.evaluation.judge import EvaluationOutcome
from app.logging import get_logger
from app.providers.openrouter import OpenRouterProvider

logger = get_logger()

router = APIRouter(tags=["evaluation"])


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    conversation_id: str


class EvaluateResponse(BaseModel):
    """JudgeResult + metadados de custo/modelo para o worker persistir (F29-S03)."""

    model_config = ConfigDict(extra="ignore")

    result: JudgeResult
    judge_model: str
    judge_cost_usd: float


def verify_token(authorization: Annotated[str | None, Header()] = None) -> None:
    settings = get_settings()
    expected = f"Bearer {settings.agent_runtime_token}"
    if not authorization or authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing runtime token",
        )


def _get_provider(request: Request) -> OpenRouterProvider:
    """Reusa o provider do grafo (publicado no lifespan); cria efemero em fallback."""
    graph = getattr(request.app.state, "graph", None)
    provider = getattr(request.app.state, "judge_provider", None)
    if provider is not None:
        return provider
    if graph is not None:
        candidate = getattr(graph, "provider", None)
        if isinstance(candidate, OpenRouterProvider):
            return candidate
    return OpenRouterProvider()


async def _log_usage(workspace_id: str, outcome: EvaluationOutcome) -> None:
    """Best-effort: grava uso do judge em `llm_usage_logs(request_type=evaluation)`."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            async with with_workspace(conn, workspace_id) as scoped:
                await scoped.execute(
                    """
                    INSERT INTO llm_usage_logs
                        (workspace_id, request_type, router, model,
                         openrouter_generation_id, upstream_provider,
                         prompt_tokens, completion_tokens, total_tokens,
                         cost_usd, metadata)
                    VALUES
                        ($1::uuid, 'evaluation', 'openrouter', $2,
                         $3, $4, $5, $6, $7, $8, $9::jsonb)
                    """,
                    workspace_id,
                    outcome.model,
                    outcome.generation_id,
                    outcome.upstream_provider,
                    outcome.prompt_tokens,
                    outcome.completion_tokens,
                    outcome.total_tokens,
                    outcome.cost_usd,
                    json.dumps({"source": "internal_evaluate"}),
                )
    except Exception as exc:  # noqa: BLE001 - log de uso e best-effort
        logger.error(
            "evaluate: falha ao registrar llm_usage_logs",
            error=type(exc).__name__,
            workspace_id=workspace_id,
        )


@router.post("/internal/evaluate", response_model=EvaluateResponse)
async def evaluate(
    req: EvaluateRequest,
    request: Request,
    _: Annotated[None, Depends(verify_token)],
) -> EvaluateResponse:
    """Avalia uma conversa encerrada e devolve o JudgeResult validado. Auth interna."""
    settings = get_settings()
    provider = _get_provider(request)
    judge_model = getattr(request.app.state, "judge_model", settings.judge_model)

    try:
        outcome = await evaluate_conversation(
            provider=provider,
            judge_model=judge_model,
            workspace_id=req.workspace_id,
            conversation_id=req.conversation_id,
        )
    except JudgeInvalidOutputError as exc:
        # Saida do judge invalida -> 422; NADA e persistido (sem retorno parcial).
        logger.warning(
            "evaluate: saida do judge invalida",
            error=type(exc).__name__,
            conversation_id=req.conversation_id,
        )
        raise HTTPException(
            status_code=422,  # Unprocessable Content (saida do judge invalida)
            detail="judge produced invalid output",
        ) from exc
    except JudgeError as exc:
        logger.error("evaluate: falha do judge", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="judge upstream unavailable",
        ) from exc

    await _log_usage(req.workspace_id, outcome)

    return EvaluateResponse(
        result=outcome.result,
        judge_model=outcome.model,
        judge_cost_usd=outcome.cost_usd,
    )
