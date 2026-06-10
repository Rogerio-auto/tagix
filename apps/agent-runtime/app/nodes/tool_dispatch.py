"""Node `tool_dispatch`: executa as tool_calls da última assistant message.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.2, §4.1, §6.6.

Lê os `tool_calls` da última mensagem assistant, executa cada um via
`registry.dispatch(key, args, ctx)` (CONTRATO com F2-S06), e anexa uma mensagem
`tool` por chamada (correlacionada por `tool_call_id`). Emite eventos
`tool_call_started` / `tool_call_completed` pelo `StreamWriter`.

Execução paralela quando `policy.allow_parallel_tools` (asyncio.gather); senão
sequencial. Incrementa `iteration` (o conditional edge usa para o cap).

O grafo NUNCA importa as tools — só conhece o registry. `ctx` é o dict acordado:
`{workspace_id, conversation_id, agent_id, execution_id, is_playground}`.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from langgraph.types import StreamWriter

from app.logging import get_logger
from app.types import AgentState, ChatMessage, PolicySnapshot, ToolRegistry

logger = get_logger()


def _parse_args(raw: str) -> dict[str, Any]:
    """Desserializa os argumentos JSON crus do modelo (tolerante a vazio/torto)."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _build_ctx(state: AgentState) -> dict[str, Any]:
    return {
        "workspace_id": state["workspace_id"],
        "conversation_id": state.get("conversation_id"),
        "agent_id": state["agent_id"],
        "execution_id": state.get("execution_id") or state.get("thread_id", ""),
        "is_playground": bool(state.get("is_playground", False)),
    }


def make_tool_dispatch_node(*, tool_registry: ToolRegistry):
    """Fábrica do node `tool_dispatch`, ligada ao tool registry injetado."""

    async def tool_dispatch_node(state: AgentState, writer: StreamWriter) -> dict[str, Any]:
        policy: PolicySnapshot = state["policy"]
        messages = state.get("messages", [])
        last = messages[-1] if messages else None
        calls = (last.tool_calls or []) if last and last.role == "assistant" else []

        if not calls:
            # Nada a despachar; só avança a iteração (guard defensivo).
            return {"iteration": state.get("iteration", 0) + 1}

        ctx = _build_ctx(state)

        async def run_one(call: dict[str, Any]) -> tuple[ChatMessage, dict[str, Any]]:
            fn = call.get("function") or {}
            key = fn.get("name") or ""
            call_id = call.get("id") or f"call_{key}"
            args = _parse_args(fn.get("arguments") or "")

            writer({"type": "tool_call_started", "tool_key": key, "args": args})
            started = time.monotonic()
            try:
                result = await tool_registry.dispatch(key, args, ctx)
            except Exception as exc:  # noqa: BLE001 - falha de tool nunca derruba o grafo
                logger.warning(
                    "tool_dispatch: tool levantou exceção",
                    tool_key=key,
                    error=type(exc).__name__,
                )
                result = {"ok": False, "content": "", "error": type(exc).__name__}
            duration_ms = int((time.monotonic() - started) * 1000)

            writer(
                {
                    "type": "tool_call_completed",
                    "tool_key": key,
                    "result": result,
                    "duration_ms": duration_ms,
                }
            )

            content = result.get("content") or ""
            if not result.get("ok", False) and result.get("error"):
                content = content or f"error: {result['error']}"

            tool_msg = ChatMessage(role="tool", content=content, tool_call_id=call_id, name=key)
            executed = {
                "tool_key": key,
                "tool_call_id": call_id,
                "ok": bool(result.get("ok", False)),
                "duration_ms": duration_ms,
            }
            return tool_msg, executed

        if policy.allow_parallel_tools and len(calls) > 1:
            results = await asyncio.gather(*(run_one(c) for c in calls))
        else:
            results = [await run_one(c) for c in calls]

        tool_messages = [r[0] for r in results]
        executed = [r[1] for r in results]

        logger.debug("tool_dispatch ok", count=len(calls), iteration=state.get("iteration", 0) + 1)
        return {
            "messages": tool_messages,
            "iteration": state.get("iteration", 0) + 1,
            "tool_calls_executed": [*state.get("tool_calls_executed", []), *executed],
        }

    return tool_dispatch_node
