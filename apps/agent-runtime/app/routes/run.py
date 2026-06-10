"""Endpoint `POST /run`: executa o grafo e faz stream SSE dos eventos.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.5, §10; CONTRATO de eventos com
> `packages/agents-client/src/types.ts` (F2-S03).

O `/run`:
  1. Autentica via Bearer `AGENT_RUNTIME_TOKEN` (callback interno do Node).
  2. Valida o body contra `AgentRunRequest` (snake_case, espelha o Zod do cliente).
  3. Monta o `AgentState` inicial e roda `graph.astream(stream_mode="custom")`.
  4. Relaya cada evento do `StreamWriter` dos nodes como frame SSE
     (`token` / `tool_call_*` / `model_blocked` / `budget_exceeded` / `error`).
  5. Detecta cap de iteração (emite `iteration_exceeded`) e, ao fim, emite `final`
     com `reply` + `usage` (com `total_cost_usd`) + `openrouter_generation_id`.

O grafo compilado vive em `request.app.state.graph` (montado pelo lifespan do
`main.py`, que injeta o tool_registry + checkpointer + provider). A rota é
agnóstica a como o grafo foi construído.

Convenção de wire: cada frame é `data: <json>\n\n`; o JSON é a union discriminada
por `type`. O cliente Node valida via Zod.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings
from app.logging import get_logger
from app.types import (
    AgentState,
    ChatMessage,
    PolicySnapshot,
    ToolDescriptor,
    UsageAccumulator,
)

logger = get_logger()

router = APIRouter(tags=["agent"])


# ---------------------------------------------------------------------------
# Request — espelha AgentRunRequestSchema (agents-client). snake_case.
# ---------------------------------------------------------------------------


class AgentRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    agent_id: str
    conversation_id: str | None = None
    contact_id: str | None = None
    thread_id: str | None = None
    user_input: str
    messages: list[ChatMessage] = Field(default_factory=list)
    policy_snapshot: PolicySnapshot
    tools: list[ToolDescriptor] = Field(default_factory=list)
    is_playground: bool = False
    metadata: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Auth — Bearer AGENT_RUNTIME_TOKEN (callback interno Node → runtime).
# ---------------------------------------------------------------------------


def verify_token(authorization: Annotated[str | None, Header()] = None) -> None:
    settings = get_settings()
    expected = f"Bearer {settings.agent_runtime_token}"
    if not authorization or authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing runtime token",
        )


# ---------------------------------------------------------------------------
# State inicial + helpers de SSE.
# ---------------------------------------------------------------------------


def _thread_id(req: AgentRunRequest) -> str:
    if req.thread_id:
        return req.thread_id
    if req.conversation_id:
        return f"conv:{req.conversation_id}"
    return f"agent:{req.agent_id}:adhoc"


def _initial_state(req: AgentRunRequest, *, execution_id: str, thread_id: str) -> AgentState:
    return {
        "workspace_id": req.workspace_id,
        "agent_id": req.agent_id,
        "conversation_id": req.conversation_id,
        "contact_id": req.contact_id,
        "thread_id": thread_id,
        "execution_id": execution_id,
        "is_playground": req.is_playground,
        "policy": req.policy_snapshot,
        "user_input": req.user_input,
        "history": req.messages,
        "messages": [],
        "tools": req.tools,
        "iteration": 0,
        "usage": UsageAccumulator(),
        "tool_calls_executed": [],
        "errors": [],
    }


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


# ---------------------------------------------------------------------------
# Endpoint.
# ---------------------------------------------------------------------------


@router.post("/run")
async def run_agent(
    req: AgentRunRequest,
    request: Request,
    _: Annotated[None, Depends(verify_token)],
) -> StreamingResponse:
    """Executa o grafo e faz stream SSE dos eventos (text/event-stream)."""
    graph = getattr(request.app.state, "graph", None)
    if graph is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="agent graph not initialized",
        )

    import uuid

    execution_id = str(uuid.uuid4())
    thread_id = _thread_id(req)
    initial = _initial_state(req, execution_id=execution_id, thread_id=thread_id)
    config = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": max(8, req.policy_snapshot.max_iterations * 2 + 4),
    }

    async def event_stream() -> AsyncIterator[str]:
        generation_id: str | None = None
        final_emitted = False
        try:
            # "custom" entrega os eventos dos nodes (token / tool_* / model_blocked /
            # budget_exceeded / iteration_exceeded / error) já no formato do contrato.
            # "updates" entrega o patch de cada node, do qual extraímos a resposta
            # final (final_reply / usage / generation_id) no node `finalize`.
            async for mode, chunk in graph.astream(
                initial, config=config, stream_mode=["custom", "updates"]
            ):
                if mode == "custom":
                    if isinstance(chunk, dict) and "type" in chunk:
                        yield _sse(chunk)
                    continue

                # mode == "updates": {node_name: patch}
                if not isinstance(chunk, dict):
                    continue
                for node_name, patch in chunk.items():
                    if not isinstance(patch, dict):
                        continue
                    if patch.get("generation_id"):
                        generation_id = patch["generation_id"]
                    if node_name == "finalize":
                        reply, usage = _final_payload(patch)
                        yield _sse(
                            {
                                "type": "final",
                                "reply": reply,
                                "usage": usage,
                                "openrouter_generation_id": generation_id,
                            }
                        )
                        final_emitted = True
        except Exception as exc:  # noqa: BLE001 - qualquer falha vira evento error
            logger.error("run: falha na execução do grafo", error=type(exc).__name__)
            yield _sse({"type": "error", "message": "agent execution failed"})
            return

        if not final_emitted:
            # Salvaguarda: o grafo terminou sem passar por finalize (caminho
            # inesperado) — ainda devolve um final mínimo para o cliente fechar.
            yield _sse(
                {
                    "type": "final",
                    "reply": "",
                    "usage": UsageAccumulator().model_dump(),
                    "openrouter_generation_id": generation_id,
                }
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _final_payload(finalize_patch: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    reply = finalize_patch.get("final_reply") or ""
    usage = finalize_patch.get("usage")
    if isinstance(usage, UsageAccumulator):
        usage_dict = usage.model_dump()
    elif isinstance(usage, dict):
        usage_dict = usage
    else:
        usage_dict = UsageAccumulator().model_dump()
    return reply, usage_dict
