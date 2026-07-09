"""Testes do node `finalize` (F56-S01): gravação de `llm_usage_logs.latency_ms`.

AG-07: o INSERT em `llm_usage_logs` não gravava `latency_ms` (coluna real do
schema, `packages/db/src/schema/llm.ts`). O `call_model` agora mede o wall-time
das chamadas ao modelo e propaga em `agent["latency_ms"]`; o `finalize` persiste.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from app.nodes.finalize import make_finalize_node
from app.types import AgentState, ChatMessage, PolicySnapshot, UsageAccumulator

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeConn:
    """Conn fake que grava (query, args) de cada execute — compatível com
    `with_workspace` (transaction + SET LOCAL)."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield

    async def execute(self, query: str, *args: Any) -> str:
        self.calls.append((query, args))
        return "OK"


class FakePool:
    def __init__(self) -> None:
        self.conn = FakeConn()

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[FakeConn]:
        yield self.conn


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _policy() -> PolicySnapshot:
    return PolicySnapshot(
        allowed_models=["openai/gpt-4o-mini"],
        allow_streaming=False,
        allow_interrupts=False,
        allow_parallel_tools=True,
        allow_vision=False,
        allow_transcription=False,
        max_iterations=3,
        max_tokens_per_call=256,
        max_tools_per_agent=8,
        allowed_tool_categories=["database"],
        remaining_monthly_budget_usd=None,
    )


def _state(agent: dict[str, Any]) -> AgentState:
    return {
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "agent_id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": "44444444-4444-4444-4444-444444444444",
        "thread_id": "test-thread",
        "execution_id": "33333333-3333-3333-3333-333333333333",
        "is_playground": False,
        "policy": _policy(),
        "agent": agent,
        "messages": [ChatMessage(role="assistant", content="resposta final")],
        "usage": UsageAccumulator(
            prompt_tokens=10, completion_tokens=5, total_tokens=15, total_cost_usd=0.001
        ),
        "generation_id": "gen-1",
        "tool_calls_executed": [],
        "errors": [],
    }


async def _run_finalize(agent: dict[str, Any]) -> FakePool:
    pool = FakePool()
    node = make_finalize_node(pool)
    events: list[dict[str, Any]] = []
    out = await node(_state(agent), events.append)
    assert out["final_reply"] == "resposta final"
    return pool


def _find_insert(pool: FakePool, table: str) -> tuple[str, tuple[Any, ...]]:
    for query, args in pool.conn.calls:
        if f"INSERT INTO {table}" in query:
            return query, args
    raise AssertionError(f"INSERT em {table} não executado")


def _arg_for(query: str, args: tuple[Any, ...], column: str) -> Any:
    """Resolve o argumento vinculado à `column` do INSERT (ignora literais SQL)."""
    match = re.search(r"INSERT INTO llm_usage_logs\s*\(([^)]*)\)", query)
    assert match is not None
    names = [c.strip() for c in match.group(1).split(",")]
    literals = {"request_type", "router"}  # 'chat' / 'openrouter' hardcoded no VALUES
    idx = names.index(column)
    idx -= sum(1 for name in names[:idx] if name in literals)
    return args[idx]


def _assert_placeholders_match_args(query: str, args: tuple[Any, ...]) -> None:
    """Guard contra renumeração quebrada: $1..$N contíguos = len(args)."""
    placeholders = {int(n) for n in re.findall(r"\$(\d+)", query)}
    assert placeholders == set(range(1, len(args) + 1))


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_finalize_writes_latency_ms_to_llm_usage_logs() -> None:
    pool = await _run_finalize({"model": "openai/gpt-4o-mini", "latency_ms": 1234})

    query, args = _find_insert(pool, "llm_usage_logs")
    assert "latency_ms" in query
    _assert_placeholders_match_args(query, args)
    assert _arg_for(query, args, "latency_ms") == 1234
    assert _arg_for(query, args, "model") == "openai/gpt-4o-mini"
    assert _arg_for(query, args, "total_tokens") == 15


@pytest.mark.asyncio
async def test_finalize_latency_ms_null_when_not_measured() -> None:
    pool = await _run_finalize({"model": "openai/gpt-4o-mini"})

    query, args = _find_insert(pool, "llm_usage_logs")
    assert _arg_for(query, args, "latency_ms") is None


@pytest.mark.asyncio
async def test_finalize_still_upserts_agent_execution() -> None:
    pool = await _run_finalize({"model": "openai/gpt-4o-mini", "latency_ms": 10})

    query, args = _find_insert(pool, "agent_executions")
    _assert_placeholders_match_args(query, args)
