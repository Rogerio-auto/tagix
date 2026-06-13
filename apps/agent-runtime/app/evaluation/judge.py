"""Orquestracao do LLM-judge (F29-S02).

`evaluate_conversation` (a) le o transcript da conversa sob RLS do workspace,
(b) chama o OpenRouter (modelo judge barato, temperature baixa, JSON mode forcado),
(c) valida a saida contra `JudgeResult`. Saida invalida -> `JudgeInvalidOutputError`
(o caller responde 422 e NADA e persistido — sem retorno parcial, SS2.4).

Nao escreve no banco e nao loga uso: o route (evaluate.py) faz o log em
llm_usage_logs(request_type='evaluation') e o worker (F29-S03) persiste a avaliacao.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, cast

import asyncpg
from pydantic import ValidationError

from app.db import get_pool, with_workspace
from app.evaluation.prompt import TranscriptLine, build_messages, render_transcript
from app.evaluation.schema import JudgeResult
from app.logging import get_logger
from app.providers.errors import OpenRouterError
from app.providers.openrouter import OpenRouterProvider
from app.providers.types import ChatResult

logger = get_logger()

# Limite de mensagens lidas por avaliacao (transcript longo nao explode o custo).
_MAX_MESSAGES = 200


class JudgeError(Exception):
    """Falha generica do judge (upstream/transporte)."""


class JudgeInvalidOutputError(JudgeError):
    """A saida do LLM nao e JSON valido / nao bate o schema -> descartar."""


@dataclass(frozen=True)
class EvaluationOutcome:
    """Resultado da avaliacao + metadados de custo para o log de uso."""

    result: JudgeResult
    model: str
    cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    generation_id: str | None
    upstream_provider: str | None


def _role_of(sender_type: str, direction: str) -> str:
    """Mapeia (sender_type, direction) da mensagem para o papel do transcript."""
    if sender_type == "contact":
        return "contact"
    if sender_type == "agent":
        return "ai"
    if sender_type == "member":
        return "human"
    return "system"


async def _load_transcript(
    pool: asyncpg.Pool, workspace_id: str, conversation_id: str
) -> list[TranscriptLine]:
    """Le as mensagens da conversa (ordem cronologica) sob RLS do workspace."""
    async with pool.acquire() as conn:
        async with with_workspace(conn, workspace_id) as scoped:
            rows = await scoped.fetch(
                """
                SELECT sender_type, direction, content
                FROM messages
                WHERE conversation_id = $1::uuid
                  AND content IS NOT NULL
                  AND type = 'text'
                ORDER BY created_at ASC
                LIMIT $2
                """,
                conversation_id,
                _MAX_MESSAGES,
            )
    return [
        TranscriptLine(role=_role_of(r["sender_type"], r["direction"]), content=r["content"])
        for r in rows
    ]


def _parse_result(raw_content: str | None) -> JudgeResult:
    """Parseia + valida a saida do judge. Erro -> JudgeInvalidOutputError."""
    if not raw_content or not raw_content.strip():
        raise JudgeInvalidOutputError("judge devolveu conteudo vazio")
    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        raise JudgeInvalidOutputError("saida do judge nao e JSON valido") from exc
    if not isinstance(data, dict):
        raise JudgeInvalidOutputError("saida do judge nao e um objeto JSON")
    try:
        return JudgeResult.model_validate(data)
    except ValidationError as exc:
        raise JudgeInvalidOutputError("saida do judge nao bate o schema") from exc


async def evaluate_conversation(
    *,
    provider: OpenRouterProvider,
    judge_model: str,
    workspace_id: str,
    conversation_id: str,
) -> EvaluationOutcome:
    """Avalia uma conversa encerrada e devolve o `JudgeResult` validado + custo.

    Determinismo: temperature 0 + response_format json_object. Saida invalida
    levanta `JudgeInvalidOutputError` (nada e persistido).
    """
    lines = await _load_transcript(get_pool(), workspace_id, conversation_id)
    transcript = render_transcript(lines)
    messages = build_messages(transcript)

    completion = provider.chat(
        model=judge_model,
        messages=cast(list[dict[str, Any]], messages),
        temperature=0,
        max_tokens=800,
        response_format={"type": "json_object"},
    )
    try:
        result: ChatResult = await cast(Any, completion)
    except OpenRouterError as exc:
        raise JudgeError("falha upstream do judge (OpenRouter)") from exc

    judge = _parse_result(result.content)
    logger.info(
        "judge avaliou conversa",
        conversation_id=conversation_id,
        quality=judge.quality_score,
        handled_by=judge.handled_by,
        objections=len(judge.objections),
        msgs=len(lines),
    )
    return EvaluationOutcome(
        result=judge,
        model=result.model or judge_model,
        cost_usd=float(result.usage.cost_usd or 0.0),
        prompt_tokens=result.usage.prompt_tokens,
        completion_tokens=result.usage.completion_tokens,
        total_tokens=result.usage.total_tokens,
        generation_id=result.generation_id,
        upstream_provider=result.upstream_provider,
    )
