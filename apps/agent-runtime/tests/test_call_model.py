"""Testes do node `call_model` (F56-S01): clamp de max_tokens + latência.

AG-02: `max_tokens_per_call` da policy é teto DURO do workspace — o antigo
`setdefault` só aplicava o cap quando o agente não trazia `max_tokens` próprio,
deixando um `maxTokens` alto em `model_params` burlar o limite.

AG-07: o wall-time de cada chamada ao modelo é medido com clock monotônico e
acumulado no canal `agent` do state (`agent["latency_ms"]`), de onde o
`finalize` grava `llm_usage_logs.latency_ms`.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.nodes.call_model import make_call_model_node
from app.providers import ChatResult, Usage
from app.types import AgentState, PolicySnapshot, UsageAccumulator

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeProvider:
    """Captura os params efetivos enviados ao provider (inclui max_tokens)."""

    def __init__(self, result: ChatResult) -> None:
        self._result = result
        self.calls: list[dict[str, Any]] = []

    async def chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **params: Any,
    ) -> ChatResult:
        self.calls.append({"model": model, "stream": stream, **params})
        return self._result


class FakeRegistry:
    def specs_for(self, allowed_keys: set[str] | None) -> list[dict[str, Any]]:
        return []

    async def dispatch(
        self, key: str, args: dict[str, Any], ctx: dict[str, Any]
    ) -> dict[str, Any]:  # pragma: no cover - não exercido aqui
        return {"ok": True, "content": "", "error": None}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CAP = 256


def _policy(**overrides: Any) -> PolicySnapshot:
    base: dict[str, Any] = {
        "allowed_models": ["openai/gpt-4o-mini"],
        "allow_streaming": False,
        "allow_interrupts": False,
        "allow_parallel_tools": True,
        "allow_vision": False,
        "allow_transcription": False,
        "max_iterations": 3,
        "max_tokens_per_call": _CAP,
        "max_tools_per_agent": 8,
        "allowed_tool_categories": ["database"],
        "remaining_monthly_budget_usd": None,
    }
    base.update(overrides)
    return PolicySnapshot(**base)


def _state(agent: dict[str, Any]) -> AgentState:
    return {
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "agent_id": "11111111-1111-1111-1111-111111111111",
        "thread_id": "test-thread",
        "policy": _policy(),
        "agent": agent,
        "messages": [],
        "tools": [],
        "usage": UsageAccumulator(),
        "errors": [],
    }


def _result() -> ChatResult:
    return ChatResult(
        content="olá",
        tool_calls=[],
        finish_reason="stop",
        usage=Usage(prompt_tokens=10, completion_tokens=5, total_tokens=15, cost_usd=0.001),
        generation_id="gen-1",
    )


async def _run(agent: dict[str, Any]) -> tuple[FakeProvider, dict[str, Any]]:
    provider = FakeProvider(_result())
    node = make_call_model_node(provider=provider, tool_registry=FakeRegistry())
    events: list[dict[str, Any]] = []
    patch = await node(_state(agent), events.append)
    return provider, patch


def _agent(model_params: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    return {"model": "openai/gpt-4o-mini", "model_params": model_params or {}, **extra}


# ---------------------------------------------------------------------------
# AG-02 — clamp de max_tokens ao teto da policy
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_max_tokens_above_cap_is_clamped() -> None:
    provider, _ = await _run(_agent({"max_tokens": 100_000}))
    assert provider.calls[0]["max_tokens"] == _CAP


@pytest.mark.asyncio
async def test_max_tokens_below_cap_is_preserved() -> None:
    provider, _ = await _run(_agent({"max_tokens": 64}))
    assert provider.calls[0]["max_tokens"] == 64


@pytest.mark.asyncio
async def test_max_tokens_absent_defaults_to_cap() -> None:
    provider, _ = await _run(_agent({}))
    assert provider.calls[0]["max_tokens"] == _CAP


@pytest.mark.asyncio
async def test_max_tokens_non_numeric_falls_back_to_cap() -> None:
    provider, _ = await _run(_agent({"max_tokens": "muito"}))
    assert provider.calls[0]["max_tokens"] == _CAP


@pytest.mark.asyncio
async def test_clamp_does_not_mutate_agent_model_params() -> None:
    params = {"max_tokens": 100_000}
    await _run(_agent(params))
    assert params == {"max_tokens": 100_000}


# ---------------------------------------------------------------------------
# AG-07 — latência da chamada propagada no state
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_latency_ms_is_measured_and_patched(monkeypatch: pytest.MonkeyPatch) -> None:
    ticks = iter([10.0, 10.25])  # started_at → fim da chamada: 250ms
    monkeypatch.setattr("app.nodes.call_model.monotonic", lambda: next(ticks))

    _, patch = await _run(_agent({}))

    assert patch["agent"]["latency_ms"] == 250
    # O restante do contexto do agente é preservado no patch.
    assert patch["agent"]["model"] == "openai/gpt-4o-mini"


@pytest.mark.asyncio
async def test_latency_ms_accumulates_across_iterations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ticks = iter([100.0, 100.1])  # +100ms nesta chamada
    monkeypatch.setattr("app.nodes.call_model.monotonic", lambda: next(ticks))

    # Uma iteração anterior do loop já registrou 40ms.
    _, patch = await _run(_agent({}, latency_ms=40))

    assert patch["agent"]["latency_ms"] == 140
