"""Montagem do grafo LangGraph do agente (F2-S05).

> **source:** `docs/AGENTS_LANGGRAPH.md` §3.3, §4.

Forma do grafo:

    load_context → build_prompt → call_model → ┬→ tool_dispatch ─┐
                                               │                  │ (loop)
                                               └→ finalize → END  │
                                                  ▲               │
                                                  └───────────────┘

`should_continue_loop` é o conditional edge: vai para `tool_dispatch` enquanto a
última assistant message tiver tool_calls E `iteration < policy.max_iterations`;
caso contrário, `finalize`. Atingir o cap emite `iteration_exceeded` (no `/run`).

`build_graph(*, tool_registry, checkpointer, provider=None, pool=None)` é a
fábrica. O grafo recebe TODOS os colaboradores por injeção — não importa tools
concretas (CONTRATO F2-S06) e fica testável com fakes.
"""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, StateGraph

from app.db import get_pool
from app.logging import get_logger
from app.nodes import (
    build_prompt_node,
    make_call_model_node,
    make_finalize_node,
    make_load_context_node,
    make_tool_dispatch_node,
)
from app.providers import OpenRouterProvider
from app.types import AgentState, PolicySnapshot, ToolRegistry

logger = get_logger()


def should_continue_loop(state: AgentState) -> Literal["tool_dispatch", "finalize"]:
    """Decide loop de tools vs finalização (depois de `call_model`)."""
    if state.get("model_blocked_reason") or state.get("budget_exceeded"):
        return "finalize"

    messages = state.get("messages", [])
    last = messages[-1] if messages else None
    if last is None or last.role != "assistant":
        return "finalize"

    if last.tool_calls:
        policy: PolicySnapshot = state["policy"]
        if state.get("iteration", 0) >= policy.max_iterations:
            return "finalize"
        return "tool_dispatch"

    return "finalize"


def build_graph(
    *,
    tool_registry: ToolRegistry,
    checkpointer: Any,
    provider: Any | None = None,
    pool: Any | None = None,
):
    """Monta e compila o StateGraph do agente.

    - `tool_registry`: seam de tools (F2-S06). Obrigatório.
    - `checkpointer`: AsyncPostgresSaver já com `setup()` (ver `app/checkpoint.py`).
    - `provider`: instância OpenRouter; default cria uma `OpenRouterProvider()`.
    - `pool`: asyncpg pool; default usa o pool global (`app.db.get_pool()`).

    Em testes, injete `provider`, `pool` e `tool_registry` fakes e um checkpointer
    em memória (ou `None` se não precisar de persistência).
    """
    resolved_provider = provider if provider is not None else OpenRouterProvider()
    resolved_pool = pool if pool is not None else get_pool()

    builder: StateGraph = StateGraph(AgentState)

    builder.add_node("load_context", make_load_context_node(resolved_pool))
    builder.add_node("build_prompt", build_prompt_node)
    builder.add_node(
        "call_model",
        make_call_model_node(provider=resolved_provider, tool_registry=tool_registry),
    )
    builder.add_node("tool_dispatch", make_tool_dispatch_node(tool_registry=tool_registry))
    builder.add_node("finalize", make_finalize_node(resolved_pool))

    builder.set_entry_point("load_context")
    builder.add_edge("load_context", "build_prompt")
    builder.add_edge("build_prompt", "call_model")
    builder.add_conditional_edges(
        "call_model",
        should_continue_loop,
        {"tool_dispatch": "tool_dispatch", "finalize": "finalize"},
    )
    builder.add_edge("tool_dispatch", "call_model")
    builder.add_edge("finalize", END)

    compiled = builder.compile(checkpointer=checkpointer)
    logger.info("grafo LangGraph compilado")
    return compiled
