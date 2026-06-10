"""Tool `mark_resolved` — fecha a conversa como resolvida (§7.4).

Tool de workflow (callback Node). Marca a conversa como `status = 'resolved'`.
O Node é a fonte de verdade do ciclo de vida da conversa; a aprovação humana
("sempre", conforme §7.4) é aplicada lá — esta tool apenas dispara a ação e
surface a resposta do Node (que pode indicar pendência de aprovação).

Contrato Node (`POST /internal/tools/mark_resolved`):
  - envelope `args`: `{ resolution: str }`
  - mutação: `conversations.status = 'resolved'` (ou enfileira para aprovação,
    se a política do workspace exigir), grava `tool_logs`.
  - resposta: `{ ok, content, payload?: { status, pending_approval? } }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class MarkResolvedArgs(BaseModel):
    """Argumentos para marcar a conversa como resolvida."""

    resolution: str = Field(
        description=(
            "Resumo de como a solicitação do cliente foi resolvida, em uma ou duas "
            "frases (fica registrado no histórico da conversa)."
        ),
        min_length=1,
        max_length=1000,
    )


class MarkResolvedTool(CallbackTool):
    key = "mark_resolved"
    name = "Marcar como resolvida"
    description = (
        "Fecha a conversa marcando-a como resolvida. Use somente quando o pedido "
        "do cliente foi de fato atendido e não há mais nada pendente. Dependendo "
        "da configuração do workspace, pode exigir aprovação de um atendente antes "
        "de fechar de fato."
    )
    category = "workflow"
    Args = MarkResolvedArgs
