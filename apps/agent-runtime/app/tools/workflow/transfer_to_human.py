"""Tool `transfer_to_human` — entrega a conversa a um atendente humano (§7.4).

Tool de workflow (callback Node): o efeito de negócio — `conversations.ai_mode =
'off'` + atribuição a um atendente/departamento — é *single source of truth* no
Node. Esta subclasse só declara metadados + `Args`; o transporte HTTP, auth e
normalização vivem em `CallbackTool` (F2-S07).

Contrato Node (`POST /internal/tools/transfer_to_human`):
  - envelope `args`: `{ reason: str, department_id: str | None }`
  - mutação: `conversations.ai_mode = 'off'`, opcionalmente
    `conversations.assigned_department_id = <department_id>` (ou roteia por
    round-robin), grava `tool_logs`.
  - resposta: `{ ok, content, payload?: { transferred_to } }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class TransferToHumanArgs(BaseModel):
    """Argumentos que a LLM deve fornecer para transferir a conversa."""

    reason: str = Field(
        description="Motivo da transferência, em uma frase (registrado para o atendente).",
        min_length=1,
        max_length=500,
    )
    department_id: str | None = Field(
        default=None,
        description=(
            "ID do departamento de destino, se o atendimento deve ir para uma fila "
            "específica. Omitir deixa o roteamento a cargo do sistema."
        ),
    )


class TransferToHumanTool(CallbackTool):
    key = "transfer_to_human"
    name = "Transferir para humano"
    description = (
        "Tira o agente de IA da conversa e a entrega a um atendente humano. "
        "Use quando o cliente pede explicitamente falar com uma pessoa, ou quando "
        "o pedido está fora da sua capacidade. Após transferir, não responda mais."
    )
    category = "workflow"
    Args = TransferToHumanArgs
