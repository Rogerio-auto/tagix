"""Testes de `app.policy` (F2-S08): filtro de tools, block de modelo, clamp.

Pure functions, sem I/O — exercitamos o comportamento que `load_context` delega.
Casos cobrem: tool filtrada por categoria, cap `max_tools_per_agent`, modelo
bloqueado, modelo permitido, e clamp de `max_iterations`. Os cenários espelham a
lógica inline que vivia em `load_context.py` (paridade exata).
"""

from __future__ import annotations

from typing import Any

from app.policy import (
    PolicyDecision,
    PolicyViolation,
    apply_policy,
    effective_max_iterations,
    filter_tools,
    model_block_reason,
)
from app.types import PolicySnapshot, ToolDescriptor


def _policy(**overrides: Any) -> PolicySnapshot:
    base: dict[str, Any] = {
        "allowed_models": ["openai/gpt-4o-mini"],
        "max_iterations": 5,
        "max_tools_per_agent": 16,
        "allowed_tool_categories": ["database"],
    }
    base.update(overrides)
    return PolicySnapshot(**base)


def _tool(key: str, category: str = "database") -> ToolDescriptor:
    return ToolDescriptor(key=key, category=category)


# ---------------------------------------------------------------------------
# filter_tools — categoria
# ---------------------------------------------------------------------------


def test_filter_tools_drops_tool_outside_allowed_category() -> None:
    tools = [_tool("query_contact", "database"), _tool("send_email", "messaging")]
    out = filter_tools(tools, _policy(allowed_tool_categories=["database"]))
    assert [t.key for t in out] == ["query_contact"]


def test_filter_tools_empty_categories_means_no_restriction() -> None:
    # Lista vazia de categorias = sem restrição declarada → mantém tudo.
    tools = [_tool("a", "database"), _tool("b", "messaging"), _tool("c", "")]
    out = filter_tools(tools, _policy(allowed_tool_categories=[], max_tools_per_agent=16))
    assert [t.key for t in out] == ["a", "b", "c"]


def test_filter_tools_empty_descriptor_category_denied_when_restricted() -> None:
    # Categoria vazia no descriptor nunca passa o filtro (deny-by-default).
    tools = [_tool("a", "database"), _tool("b", "")]
    out = filter_tools(tools, _policy(allowed_tool_categories=["database"]))
    assert [t.key for t in out] == ["a"]


# ---------------------------------------------------------------------------
# filter_tools — cap max_tools_per_agent
# ---------------------------------------------------------------------------


def test_filter_tools_caps_at_max_tools_per_agent() -> None:
    tools = [_tool(f"t{i}") for i in range(5)]
    out = filter_tools(tools, _policy(max_tools_per_agent=2))
    assert [t.key for t in out] == ["t0", "t1"]


def test_filter_tools_negative_cap_means_unlimited() -> None:
    tools = [_tool(f"t{i}") for i in range(5)]
    out = filter_tools(tools, _policy(max_tools_per_agent=-1))
    assert len(out) == 5


def test_filter_tools_zero_cap_yields_empty() -> None:
    tools = [_tool("a"), _tool("b")]
    out = filter_tools(tools, _policy(max_tools_per_agent=0))
    assert out == []


# ---------------------------------------------------------------------------
# model_block_reason
# ---------------------------------------------------------------------------


def test_model_blocked_when_outside_whitelist() -> None:
    reason = model_block_reason(
        "anthropic/claude-3.5-sonnet",
        _policy(allowed_models=["openai/gpt-4o-mini"]),
    )
    assert reason == "model not allowed by workspace policy: anthropic/claude-3.5-sonnet"


def test_model_allowed_returns_none() -> None:
    reason = model_block_reason(
        "openai/gpt-4o-mini",
        _policy(allowed_models=["openai/gpt-4o-mini"]),
    )
    assert reason is None


def test_model_empty_whitelist_allows_everything() -> None:
    # Whitelist vazia = sem restrição → nunca bloqueia.
    assert model_block_reason("anything/at-all", _policy(allowed_models=[])) is None


# ---------------------------------------------------------------------------
# effective_max_iterations — clamp
# ---------------------------------------------------------------------------


def test_max_iterations_clamped_down_to_policy_ceiling() -> None:
    assert effective_max_iterations(_policy(max_iterations=3), default=10) == 3


def test_max_iterations_keeps_default_under_ceiling() -> None:
    assert effective_max_iterations(_policy(max_iterations=10), default=4) == 4


def test_max_iterations_never_negative() -> None:
    assert effective_max_iterations(_policy(max_iterations=-5), default=10) == 0


# ---------------------------------------------------------------------------
# apply_policy — conveniência
# ---------------------------------------------------------------------------


def test_apply_policy_combines_filter_and_block() -> None:
    decision = apply_policy(
        tools=[_tool("a", "database"), _tool("b", "messaging")],
        model="anthropic/claude-3.5-sonnet",
        snapshot=_policy(
            allowed_models=["openai/gpt-4o-mini"],
            allowed_tool_categories=["database"],
            max_tools_per_agent=16,
        ),
    )
    assert isinstance(decision, PolicyDecision)
    assert [t.key for t in decision.tools] == ["a"]
    assert decision.model_blocked_reason == (
        "model not allowed by workspace policy: anthropic/claude-3.5-sonnet"
    )


def test_apply_policy_allows_clean_path() -> None:
    decision = apply_policy(
        tools=[_tool("a", "database")],
        model="openai/gpt-4o-mini",
        snapshot=_policy(),
    )
    assert [t.key for t in decision.tools] == ["a"]
    assert decision.model_blocked_reason is None


def test_policy_violation_is_exception_subclass() -> None:
    assert issubclass(PolicyViolation, Exception)
