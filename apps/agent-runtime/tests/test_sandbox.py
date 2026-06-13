"""Testes do modo sandbox / Agent Playground (F26-S06).

PROVA a invariante de ZERO side-effect de producao:
  - sandbox NAO grava em agent_executions (dado de producao);
  - o custo do teste vai para llm_usage_logs com is_test=TRUE (fora do cap/billing);
  - tools de side-effect (callback ao Node) viram mock "would-do" -- nada e enviado;
  - a policy enforcement (whitelist de modelo) continua valendo igual ao live.

Sem rede e sem DB real: provider, registry e pool asyncpg sao fakes; o pool registra
(query, args) de cada execute para inspecao.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from app.graph import build_graph
from app.providers import ChatResult, Usage
from app.sandbox import is_sandbox
from app.tools.base import ToolContext, ToolResult
from app.tools.callback import CallbackTool
from app.types import AgentState, PolicySnapshot, ToolDescriptor, UsageAccumulator


# ── Fakes (recordando query+args para inspecao) ──────────────────────────────
class _RecConn:
    def __init__(self, agent_row: dict[str, Any]) -> None:
        self._agent_row = agent_row
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield

    async def execute(self, query: str, *args: Any) -> str:
        self.calls.append((query, args))
        return "OK"

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if "FROM agents" in query:
            return self._agent_row
        return None


class _RecPool:
    def __init__(self, agent_row: dict[str, Any]) -> None:
        self.conn = _RecConn(agent_row)

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_RecConn]:
        yield self.conn


class _Provider:
    def __init__(self, result: ChatResult) -> None:
        self._result = result

    async def chat(self, **_: Any) -> ChatResult:
        return self._result


class _Registry:
    def specs_for(self, allowed_keys: set[str] | None) -> list[dict[str, Any]]:
        return []

    async def dispatch(
        self, key: str, args: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:
        return {"ok": True, "content": "noop", "error": None}


def _policy(**ov: Any) -> PolicySnapshot:
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
    base.update(ov)
    return PolicySnapshot(**base)


def _agent_row(model: str = "openai/gpt-4o-mini") -> dict[str, Any]:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Vendedor",
        "model": model,
        "model_params": {},
        "system_prompt": "Voce e um vendedor.",
        "model_supports_vision": False,
    }


def _state(policy: PolicySnapshot, *, mode_sandbox: bool) -> AgentState:
    return {
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "agent_id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": "44444444-4444-4444-4444-444444444444",
        "contact_id": None,
        "thread_id": "sandbox-thread",
        "execution_id": "33333333-3333-3333-3333-333333333333",
        "is_playground": mode_sandbox,
        "policy": policy,
        "user_input": "Oi",
        "history": [],
        "messages": [],
        "tools": [ToolDescriptor(key="x", name="x", description="d", category="database")],
        "iteration": 0,
        "usage": UsageAccumulator(),
        "tool_calls_executed": [],
        "errors": [],
    }


def _text_result() -> ChatResult:
    return ChatResult(
        content="Ola!",
        tool_calls=[],
        finish_reason="stop",
        usage=Usage(prompt_tokens=10, completion_tokens=5, total_tokens=15, cost_usd=0.002),
        generation_id="gen-final",
    )


_CONFIG = {"configurable": {"thread_id": "sandbox-thread"}}


def _build(pool: _RecPool):
    return build_graph(
        tool_registry=_Registry(),
        checkpointer=MemorySaver(),
        provider=_Provider(_text_result()),
        pool=pool,
    )


# ── is_sandbox predicate ─────────────────────────────────────────────────────
def test_is_sandbox_predicate() -> None:
    assert is_sandbox(_state(_policy(), mode_sandbox=True)) is True
    assert is_sandbox(_state(_policy(), mode_sandbox=False)) is False


# ── Persistencia: zero side-effect em sandbox ────────────────────────────────
@pytest.mark.asyncio
async def test_sandbox_nao_grava_agent_executions() -> None:
    pool = _RecPool(_agent_row())
    graph = _build(pool)
    await graph.ainvoke(_state(_policy(), mode_sandbox=True), config=_CONFIG)
    queries = " ".join(q for q, _ in pool.conn.calls)
    assert "INSERT INTO agent_executions" not in queries


@pytest.mark.asyncio
async def test_live_grava_agent_executions() -> None:
    pool = _RecPool(_agent_row())
    graph = _build(pool)
    await graph.ainvoke(_state(_policy(), mode_sandbox=False), config=_CONFIG)
    queries = " ".join(q for q, _ in pool.conn.calls)
    assert "INSERT INTO agent_executions" in queries


@pytest.mark.asyncio
async def test_sandbox_marca_is_test_true_no_usage_log() -> None:
    pool = _RecPool(_agent_row())
    graph = _build(pool)
    await graph.ainvoke(_state(_policy(), mode_sandbox=True), config=_CONFIG)
    usage_calls = [args for q, args in pool.conn.calls if "INSERT INTO llm_usage_logs" in q]
    assert usage_calls, "esperava uma linha de llm_usage_logs"
    # is_test e o penultimo parametro ($13), antes do metadata jsonb ($14).
    args = usage_calls[0]
    assert args[-2] is True  # is_test=True em sandbox
    metadata = json.loads(args[-1])
    assert metadata.get("playground") is True


@pytest.mark.asyncio
async def test_live_marca_is_test_false_no_usage_log() -> None:
    pool = _RecPool(_agent_row())
    graph = _build(pool)
    await graph.ainvoke(_state(_policy(), mode_sandbox=False), config=_CONFIG)
    usage_calls = [args for q, args in pool.conn.calls if "INSERT INTO llm_usage_logs" in q]
    assert usage_calls
    assert usage_calls[0][-2] is False  # is_test=False em live


# ── Policy enforcement continua valendo em sandbox ───────────────────────────
@pytest.mark.asyncio
async def test_sandbox_respeita_whitelist_de_modelo() -> None:
    # Agente usa um modelo fora da allowed_models -> bloqueado mesmo em sandbox.
    pool = _RecPool(_agent_row(model="anthropic/claude-3.5-sonnet"))
    graph = _build(pool)
    final = await graph.ainvoke(
        _state(_policy(allowed_models=["openai/gpt-4o-mini"]), mode_sandbox=True),
        config=_CONFIG,
    )
    assert final.get("model_blocked_reason")


# ── Tool de side-effect (callback) vira mock "would-do" em sandbox ───────────
class _NoopArgs(BaseModel):
    pass


class _SideEffectTool(CallbackTool):
    key = "send_message"
    name = "Enviar mensagem"
    description = "Envia uma mensagem real ao contato."
    category = "workflow"
    Args = _NoopArgs


@pytest.mark.asyncio
async def test_tool_side_effect_mockada_em_sandbox() -> None:
    tool = _SideEffectTool(client=None)
    try:
        ctx = ToolContext(
            workspace_id="22222222-2222-2222-2222-222222222222",
            agent_id="11111111-1111-1111-1111-111111111111",
            execution_id="33333333-3333-3333-3333-333333333333",
            is_playground=True,
        )
        res: ToolResult = await tool.execute({}, ctx)
        # Nao executou o callback real (nenhuma rede); resultado e simulado "would-do".
        assert res.ok is True
        assert res.payload == {"simulated": True}
        assert "simulado" in res.content.lower()
    finally:
        await tool.aclose()
