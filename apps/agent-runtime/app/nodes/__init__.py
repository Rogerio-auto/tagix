"""Nodes do grafo LangGraph (F2-S05).

Cada node é uma `async def (state, ...) -> dict` que devolve um *patch* do
`AgentState`. A ordem do grafo:

    load_context → build_prompt → call_model → (tool_dispatch ↺) → finalize → END

Os nodes que dependem de colaboradores externos (provider OpenRouter, tool
registry, pool DB) são *fábricas*: recebem o colaborador e devolvem o callable do
node. Isso mantém o grafo testável (injeta fakes) e o módulo livre de imports de
tools concretas.
"""

from __future__ import annotations

from .build_prompt import build_prompt_node
from .call_model import make_call_model_node
from .finalize import make_finalize_node
from .load_context import make_load_context_node
from .tool_dispatch import make_tool_dispatch_node

__all__ = [
    "build_prompt_node",
    "make_call_model_node",
    "make_finalize_node",
    "make_load_context_node",
    "make_tool_dispatch_node",
]
