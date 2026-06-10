"""Tool `change_conversation_status` — muda o status da conversa (§7.4).

Tool de workflow (callback Node). Transição genérica de status (ex.: `open` →
`pending`). O conjunto válido de status e as transições permitidas são validados
no Node (single source of truth); aqui declaramos os valores conhecidos para
guiar a LLM, mas o Node é autoritativo e pode recusar uma transição inválida.

Contrato Node (`POST /internal/tools/change_conversation_status`):
  - envelope `args`: `{ target_status: "open"|"pending"|"resolved"|"closed",
    note: str | None }`
  - mutação: `conversations.status = <target_status>` (após validar a transição),
    grava `tool_logs`.
  - resposta: `{ ok, content, payload?: { status } }`.

Nota: `mark_resolved` é o atalho dedicado para `resolved` (com semântica de
aprovação própria); prefira-o para fechar a conversa.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool

ConversationStatus = Literal["open", "pending", "resolved", "closed"]


class ChangeConversationStatusArgs(BaseModel):
    """Argumentos para alterar o status da conversa."""

    target_status: ConversationStatus = Field(
        description=(
            "Novo status da conversa: 'open' (em atendimento), 'pending' "
            "(aguardando o cliente/terceiro), 'resolved' (resolvida), 'closed' "
            "(encerrada)."
        ),
    )
    note: str | None = Field(
        default=None,
        description="Observação opcional sobre o motivo da mudança de status.",
        max_length=500,
    )


class ChangeConversationStatusTool(CallbackTool):
    key = "change_conversation_status"
    name = "Alterar status da conversa"
    description = (
        "Altera o status da conversa (ex.: marcar como 'pending' enquanto se "
        "aguarda uma resposta do cliente). Para fechar como resolvida, prefira a "
        "ferramenta dedicada de marcar como resolvida. O sistema valida se a "
        "transição é permitida."
    )
    category = "workflow"
    Args = ChangeConversationStatusArgs
