"""`POST /copilot/run`: executa um turno do Copiloto e devolve eventos em SSE.

> **source:** `COPILOTO.md` §5.4, §8 (R5) · ADR-003.

- Auth: o mesmo bearer de serviço do `/run` (`AGENT_RUNTIME_TOKEN`).
- Body: `CopilotRunRequest` (fechado; descritor inválido ou campo extra → 422).
- Resposta: `text/event-stream`, um frame `data: <json>\\n\\n` por evento interno
  (`status`, `verdict_delta`, `tool_call_completed`, `iteration_exceeded`, `final`,
  `error`). O turno sempre termina com exatamente um `final` ou um `error`.
- Timeout total do turno (`policy.turn_timeout_s`, padrão 60) com `asyncio.timeout`:
  estourou → `error { code: 'timeout' }` e o grafo é cancelado.
- Desconexão do cliente: o Starlette cancela o gerador da resposta; o `finally`
  cancela a tarefa do grafo, que fecha o stream do OpenRouter e qualquer callback em
  curso. Nada continua gastando depois que a API desistiu.

Arquitetura: o grafo roda numa tarefa produtora que escreve numa fila; o gerador SSE
só consome a fila. Assim o `asyncio.timeout` e o cancelamento envolvem o grafo, e não
o código do Starlette que está escrevendo no socket.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from time import monotonic
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.copilot.auth import verify_runtime_token
from app.copilot.graph import recursion_limit
from app.copilot.types import (
    CopilotRunRequest,
    CopilotState,
    CopilotUsage,
    ErrorEvent,
    event_payload,
)
from app.logging import get_logger

logger = get_logger()

router = APIRouter(tags=["copilot"])

_DONE: Final = object()
_TERMINAL_TYPES: Final = frozenset({"final", "error"})


def sse_frame(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"


def initial_state(req: CopilotRunRequest, settings: Settings) -> CopilotState:
    return {
        "request": req,
        "model": req.policy.model or settings.copilot_default_model,
        "messages": [],
        "pending_tool_calls": [],
        "answer_arguments": None,
        "streamed_verdict": "",
        "last_text": None,
        "result_ids": [],
        "iterations": 0,
        "tool_calls_made": 0,
        "force_answer": False,
        "usage": CopilotUsage(),
        "failed": False,
    }


async def stream_copilot_turn(
    graph: Any, req: CopilotRunRequest, settings: Settings
) -> AsyncIterator[str]:
    """Gera os frames SSE de um turno. Cancelar/fechar o gerador cancela o grafo."""
    queue: asyncio.Queue[Any] = asyncio.Queue()
    state = initial_state(req, settings)
    config = {"recursion_limit": recursion_limit(req.policy.max_iterations)}
    started = monotonic()
    outcome = {"status": "unknown"}

    async def produce() -> None:
        terminal_seen = False
        deadline = asyncio.timeout(req.policy.turn_timeout_s)
        try:
            async with deadline:
                async for chunk in graph.astream(state, config=config, stream_mode="custom"):
                    if isinstance(chunk, dict) and "type" in chunk:
                        terminal_seen = terminal_seen or chunk["type"] in _TERMINAL_TYPES
                        outcome["status"] = str(chunk["type"])
                        queue.put_nowait(chunk)
        except asyncio.CancelledError:
            outcome["status"] = "cancelled"
            raise
        except Exception as exc:  # noqa: BLE001 - qualquer falha do grafo vira `error`
            timed_out = isinstance(exc, TimeoutError) and deadline.expired()
            if not timed_out:
                logger.error("copilot run: falha no grafo", error=type(exc).__name__)
            if not terminal_seen:  # nunca dois eventos terminais no mesmo turno
                outcome["status"] = "timeout" if timed_out else "internal"
                code = "timeout" if timed_out else "internal"
                queue.put_nowait(event_payload(ErrorEvent(code=code)))
                terminal_seen = True
        finally:
            if not terminal_seen and outcome["status"] != "cancelled":
                outcome["status"] = "internal"
                queue.put_nowait(event_payload(ErrorEvent(code="internal")))
            queue.put_nowait(_DONE)

    task = asyncio.create_task(produce(), name=f"copilot-turn-{req.turn_id}")
    try:
        while True:
            item = await queue.get()
            if item is _DONE:
                break
            yield sse_frame(item)
    finally:
        if not task.done():
            task.cancel()
            outcome["status"] = "cancelled"
        with contextlib.suppress(asyncio.CancelledError):
            await task
        logger.info(
            "copilot turn encerrado",
            turn_id=req.turn_id,
            workspace_id=req.workspace_id,
            outcome=outcome["status"],
            duration_ms=round((monotonic() - started) * 1000),
        )


@router.post("/copilot/run")
async def run_copilot(
    req: CopilotRunRequest,
    request: Request,
    _: Annotated[None, Depends(verify_runtime_token)],
) -> StreamingResponse:
    graph = getattr(request.app.state, "copilot_graph", None)
    if graph is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="copilot graph not initialized",
        )
    return StreamingResponse(
        stream_copilot_turn(graph, req, get_settings()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
