"""Tools de workflow do agent-runtime (F2-S20) — todas callback Node (§7.4).

Cada tool subclassa `CallbackTool` (F2-S07): declara `key`/`name`/`description`/
`category='workflow'` + `Args` Pydantic, e delega o efeito de negócio ao Node via
`POST /internal/tools/{key}` (single source of truth, sob RLS, grava `tool_logs`).

`register_workflow_tools(registry, http_client)` instancia cada tool com o client
httpx compartilhado injetado e a registra no `ToolRegistry` (F2-S06). O
orquestrador chama isto no lifespan do `main.py` para conectá-las ao grafo.
"""

from __future__ import annotations

import httpx

from app.tools.base import Tool
from app.tools.registry import ToolRegistry
from app.tools.workflow.change_conversation_status import (
    ChangeConversationStatusArgs,
    ChangeConversationStatusTool,
)
from app.tools.workflow.escalate import EscalateArgs, EscalateTool
from app.tools.workflow.mark_resolved import MarkResolvedArgs, MarkResolvedTool
from app.tools.workflow.move_deal_stage import MoveDealStageArgs, MoveDealStageTool
from app.tools.workflow.register_conversion import (
    RegisterConversionArgs,
    RegisterConversionTool,
)
from app.tools.workflow.transfer_to_agent import (
    TransferToAgentArgs,
    TransferToAgentTool,
)
from app.tools.workflow.transfer_to_human import (
    TransferToHumanArgs,
    TransferToHumanTool,
)

__all__ = [
    "ChangeConversationStatusArgs",
    "ChangeConversationStatusTool",
    "EscalateArgs",
    "EscalateTool",
    "MarkResolvedArgs",
    "MarkResolvedTool",
    "MoveDealStageArgs",
    "MoveDealStageTool",
    "RegisterConversionArgs",
    "RegisterConversionTool",
    "TransferToAgentArgs",
    "TransferToAgentTool",
    "TransferToHumanArgs",
    "TransferToHumanTool",
    "build_workflow_tools",
    "register_workflow_tools",
]

# Classes de tool de workflow, em ordem estável (determinismo de boot/diagnóstico).
_WORKFLOW_TOOL_CLASSES: tuple[type[Tool], ...] = (
    TransferToHumanTool,
    TransferToAgentTool,
    EscalateTool,
    MarkResolvedTool,
    ChangeConversationStatusTool,
    RegisterConversionTool,
    MoveDealStageTool,
)


def build_workflow_tools(http_client: httpx.AsyncClient) -> list[Tool]:
    """Instancia as tools de workflow com o `http_client` compartilhado injetado.

    O client é reusado por processo (não cada tool cria o seu): passamos a mesma
    instância a todas. As tools NÃO tomam posse do client (`_owns_client=False`),
    então `aclose()` delas é no-op — o dono do client (o lifespan) o fecha.
    """
    return [cls(client=http_client) for cls in _WORKFLOW_TOOL_CLASSES]


def register_workflow_tools(
    registry: ToolRegistry,
    http_client: httpx.AsyncClient,
) -> ToolRegistry:
    """Registra todas as tools de workflow no `registry` (F2-S06).

    Chamado pelo lifespan do `main.py` após `build_default_registry`, com o client
    httpx do processo. Devolve o mesmo `registry` (encadeável). Erro em key
    duplicada (contrato de `registry.register`) — fail-fast no boot.
    """
    for tool in build_workflow_tools(http_client):
        registry.register(tool)
    return registry
