"""Testes do grafo LangGraph (F2-S05): nodes, loop de tools, cap, /run stream.

Sem rede e sem DB real: o provider, o tool registry e o pool asyncpg são fakes
injetados em `build_graph(...)`. O checkpointer é o `MemorySaver` em memória.
Cobre: caminho final direto, loop de tool (1 round), cap de iteração, bloqueio de
modelo por policy, budget esgotado, e a sequência de eventos do `/run`.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.graph import build_graph, should_continue_loop
from app.providers import ChatResult, ToolCall, Usage
from app.types import (
    AgentState,
    ChatMessage,
    PolicySnapshot,
    UsageAccumulator,
)

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeRegistry:
    """ToolRegistry fake: specs estáticas + dispatch que devolve eco controlado."""

    def __init__(self, *, dispatch_result: dict[str, Any] | None = None) -> None:
        self._dispatch_result = dispatch_result or {
            "ok": True,
            "content": "tool ok",
            "error": None,
        }
        self.dispatched: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    def specs_for(self, allowed_keys: set[str] | None) -> list[dict[str, Any]]:
        keys = allowed_keys or {"query_contact"}
        return [
            {
                "type": "function",
                "function": {"name": k, "description": "", "parameters": {"type": "object"}},
            }
            for k in keys
        ]

    async def dispatch(
        self, key: str, args: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        self.dispatched.append((key, args, ctx))
        return self._dispatch_result


class FakeProvider:
    """Provider fake: devolve uma fila de ChatResult em chamadas non-stream.

    Stream não é exercido aqui (policy.allow_streaming=False nos testes de lógica);
    um teste dedicado cobre o caminho de stream do `/run`.
    """

    def __init__(self, results: list[ChatResult]) -> None:
        self._results = list(results)
        self.calls: list[dict[str, Any]] = []

    def chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **params: Any,
    ):
        self.calls.append({"model": model, "messages": messages, "tools": tools, **params})
        if stream:
            return self._stream()
        return self._next()

    async def _next(self) -> ChatResult:
        return self._results.pop(0)

    async def _stream(self) -> AsyncIterator[Any]:
        # Emite o conteúdo do próximo result como um único delta de token.
        from app.providers import StreamDelta

        result = self._results.pop(0)
        if result.content:
            yield StreamDelta(content=result.content)
        for tc in result.tool_calls:
            yield StreamDelta(tool_call=tc)
        yield StreamDelta(
            finish_reason=result.finish_reason,
            usage=result.usage,
            generation_id=result.generation_id,
        )


class _FakeConn:
    def __init__(self, agent_row: dict[str, Any]) -> None:
        self._agent_row = agent_row
        self.executed: list[str] = []

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield

    async def execute(self, query: str, *args: Any) -> str:
        self.executed.append(query.strip().split()[0].upper())
        return "OK"

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if "FROM agents" in query:
            return self._agent_row
        return None


class FakePool:
    """Pool asyncpg fake: `acquire()` async-ctx devolve um _FakeConn."""

    def __init__(self, agent_row: dict[str, Any]) -> None:
        self.conn = _FakeConn(agent_row)

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_FakeConn]:
        yield self.conn


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _policy(**overrides: Any) -> PolicySnapshot:
    base = {
        "allowed_models": ["openai/gpt-4o-mini"],
        "allow_streaming": False,
        "allow_interrupts": False,
        "allow_parallel_tools": True,
        "allow_vision": False,
        "allow_transcription": False,
        "max_iterations": 3,
        "max_tokens_per_call": 256,
        "max_tools_per_agent": 8,
        "allowed_tool_categories": ["database"],
        "remaining_monthly_budget_usd": None,
    }
    base.update(overrides)
    return PolicySnapshot(**base)


def _agent_row(model: str = "openai/gpt-4o-mini") -> dict[str, Any]:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Vendedor",
        "model": model,
        "model_params": {},
        "system_prompt": "Você é um vendedor.",
        "model_supports_vision": False,
    }


def _initial_state(
    policy: PolicySnapshot, *, tools: list[dict[str, Any]] | None = None
) -> AgentState:
    from app.types import ToolDescriptor

    return {
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "agent_id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": None,
        "contact_id": None,
        "thread_id": "test-thread",
        "execution_id": "33333333-3333-3333-3333-333333333333",
        "is_playground": False,
        "policy": policy,
        "user_input": "Oi",
        "history": [],
        "messages": [],
        "tools": [ToolDescriptor(**t) for t in (tools or [])],
        "iteration": 0,
        "usage": UsageAccumulator(),
        "tool_calls_executed": [],
        "errors": [],
    }


def _text_result(content: str) -> ChatResult:
    return ChatResult(
        content=content,
        tool_calls=[],
        finish_reason="stop",
        usage=Usage(prompt_tokens=10, completion_tokens=5, total_tokens=15, cost_usd=0.001),
        generation_id="gen-final",
    )


def _tool_result() -> ChatResult:
    return ChatResult(
        content=None,
        tool_calls=[ToolCall(id="call_1", name="query_contact", arguments='{"fields":["name"]}')],
        finish_reason="tool_calls",
        usage=Usage(prompt_tokens=8, completion_tokens=3, total_tokens=11, cost_usd=0.0005),
        generation_id="gen-tool",
    )


def _build(provider: FakeProvider, registry: FakeRegistry, pool: FakePool):
    return build_graph(
        tool_registry=registry,
        checkpointer=MemorySaver(),
        provider=provider,
        pool=pool,
    )


_CONFIG = {"configurable": {"thread_id": "test-thread"}}


# ---------------------------------------------------------------------------
# should_continue_loop (unit)
# ---------------------------------------------------------------------------


def _assistant_with_tool() -> ChatMessage:
    return ChatMessage(
        role="assistant",
        content=None,
        tool_calls=[{"id": "c", "function": {"name": "x"}}],
    )


def test_should_continue_finalize_on_plain_answer() -> None:
    state = _initial_state(_policy())
    state["messages"] = [ChatMessage(role="assistant", content="oi")]
    assert should_continue_loop(state) == "finalize"


def test_should_continue_tool_dispatch_when_tool_calls_under_cap() -> None:
    state = _initial_state(_policy(max_iterations=3))
    state["iteration"] = 1
    state["messages"] = [_assistant_with_tool()]
    assert should_continue_loop(state) == "tool_dispatch"


def test_should_continue_finalize_at_iteration_cap() -> None:
    state = _initial_state(_policy(max_iterations=2))
    state["iteration"] = 2
    state["messages"] = [_assistant_with_tool()]
    assert should_continue_loop(state) == "finalize"


def test_should_continue_finalize_when_model_blocked() -> None:
    state = _initial_state(_policy())
    state["model_blocked_reason"] = "blocked"
    state["messages"] = [_assistant_with_tool()]
    assert should_continue_loop(state) == "finalize"


# ---------------------------------------------------------------------------
# Graph end-to-end (ainvoke)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_graph_direct_final_answer() -> None:
    provider = FakeProvider([_text_result("Olá, como posso ajudar?")])
    registry = FakeRegistry()
    pool = FakePool(_agent_row())
    graph = _build(provider, registry, pool)

    out = await graph.ainvoke(_initial_state(_policy()), config=_CONFIG)

    assert out["final_reply"] == "Olá, como posso ajudar?"
    assert out["usage"].total_tokens == 15
    assert out["usage"].total_cost_usd == pytest.approx(0.001)
    assert len(provider.calls) == 1
    # finalize tentou persistir → INSERT executado no fake conn.
    assert any(q == "INSERT" for q in pool.conn.executed)


@pytest.mark.asyncio
async def test_graph_tool_loop_then_final() -> None:
    provider = FakeProvider([_tool_result(), _text_result("Pronto!")])
    registry = FakeRegistry()
    pool = FakePool(_agent_row())
    graph = _build(provider, registry, pool)

    out = await graph.ainvoke(
        _initial_state(_policy(), tools=[{"key": "query_contact", "category": "database"}]),
        config=_CONFIG,
    )

    assert out["final_reply"] == "Pronto!"
    # 2 chamadas ao modelo (1ª pede tool, 2ª responde).
    assert len(provider.calls) == 2
    # tool foi despachada uma vez com o ctx correto.
    assert len(registry.dispatched) == 1
    key, args, ctx = registry.dispatched[0]
    assert key == "query_contact"
    assert args == {"fields": ["name"]}
    assert ctx["workspace_id"] == "22222222-2222-2222-2222-222222222222"
    assert ctx["execution_id"] == "33333333-3333-3333-3333-333333333333"
    # usage acumulado das duas chamadas.
    assert out["usage"].total_tokens == 26


@pytest.mark.asyncio
async def test_graph_respects_iteration_cap() -> None:
    # Modelo SEMPRE pede tool → o cap deve forçar finalize.
    provider = FakeProvider([_tool_result() for _ in range(10)])
    registry = FakeRegistry()
    pool = FakePool(_agent_row())
    graph = _build(provider, registry, pool)

    out = await graph.ainvoke(
        _initial_state(
            _policy(max_iterations=2),
            tools=[{"key": "query_contact", "category": "database"}],
        ),
        config=_CONFIG,
    )

    # Com max_iterations=2: call(it0) → dispatch(it1) → call → dispatch(it2) → call → finalize.
    # 3 chamadas ao modelo, 2 dispatches.
    assert len(registry.dispatched) == 2
    assert out["iteration"] == 2


@pytest.mark.asyncio
async def test_graph_blocks_model_outside_policy_whitelist() -> None:
    provider = FakeProvider([_text_result("não deveria chamar")])
    registry = FakeRegistry()
    pool = FakePool(_agent_row(model="anthropic/claude-3.5-sonnet"))
    graph = _build(provider, registry, pool)

    out = await graph.ainvoke(
        _initial_state(_policy(allowed_models=["openai/gpt-4o-mini"])),
        config=_CONFIG,
    )

    assert out.get("model_blocked_reason")
    # Provider nunca foi chamado.
    assert len(provider.calls) == 0


@pytest.mark.asyncio
async def test_graph_budget_exceeded_skips_model() -> None:
    provider = FakeProvider([_text_result("não deveria chamar")])
    registry = FakeRegistry()
    pool = FakePool(_agent_row())
    graph = _build(provider, registry, pool)

    out = await graph.ainvoke(
        _initial_state(_policy(remaining_monthly_budget_usd=0.0)),
        config=_CONFIG,
    )

    assert out.get("budget_exceeded") is True
    assert len(provider.calls) == 0


# ---------------------------------------------------------------------------
# /run stream events (astream custom + updates)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_stream_emits_token_and_final() -> None:
    provider = FakeProvider([_text_result("oi mundo")])
    registry = FakeRegistry()
    pool = FakePool(_agent_row())
    graph = _build(provider, registry, pool)

    events: list[dict[str, Any]] = []
    async for mode, chunk in graph.astream(
        _initial_state(_policy(allow_streaming=True)),
        config=_CONFIG,
        stream_mode=["custom", "updates"],
    ):
        if mode == "custom":
            events.append(chunk)
        elif mode == "updates" and isinstance(chunk, dict):
            for node, patch in chunk.items():
                if node == "finalize":
                    events.append({"type": "final", "reply": patch["final_reply"]})

    types = [e["type"] for e in events]
    assert "token" in types
    assert types[-1] == "final"
    assert any(e.get("content") == "oi mundo" for e in events if e["type"] == "token")


@pytest.mark.asyncio
async def test_run_stream_emits_tool_call_events() -> None:
    provider = FakeProvider([_tool_result(), _text_result("feito")])
    registry = FakeRegistry()
    pool = FakePool(_agent_row())
    graph = _build(provider, registry, pool)

    custom_events: list[dict[str, Any]] = []
    async for mode, chunk in graph.astream(
        _initial_state(
            _policy(allow_streaming=True),
            tools=[{"key": "query_contact", "category": "database"}],
        ),
        config=_CONFIG,
        stream_mode=["custom", "updates"],
    ):
        if mode == "custom":
            custom_events.append(chunk)

    types = [e["type"] for e in custom_events]
    assert "tool_call_started" in types
    assert "tool_call_completed" in types
    completed = next(e for e in custom_events if e["type"] == "tool_call_completed")
    assert completed["tool_key"] == "query_contact"
    assert completed["result"]["ok"] is True


# ---------------------------------------------------------------------------
# Request model (espelha o contrato do cliente)
# ---------------------------------------------------------------------------


def test_run_request_parses_client_shape() -> None:
    from app.routes.run import AgentRunRequest

    body = {
        "workspace_id": "ws",
        "agent_id": "ag",
        "user_input": "oi",
        "policy_snapshot": _policy().model_dump(),
        "tools": [{"key": "query_contact", "name": "Q", "description": "", "category": "database"}],
        "messages": [{"role": "user", "content": "anterior"}],
    }
    req = AgentRunRequest.model_validate(body)
    assert req.workspace_id == "ws"
    assert req.tools[0].key == "query_contact"
    assert req.messages[0].role == "user"
    # serializa de volta sem perder snake_case
    assert "policy_snapshot" in json.loads(req.model_dump_json())
