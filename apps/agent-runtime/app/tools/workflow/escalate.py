"""Tool `escalate` — escala a conversa para um supervisor (§7.4).

Tool de workflow (callback Node). Diferente de `transfer_to_human`, NÃO tira o
agente da conversa: cria uma notificação para o papel SUPERVISOR sinalizando que
o caso precisa de atenção (risco de churn, reclamação grave, pedido sensível).

Contrato Node (`POST /internal/tools/escalate`):
  - envelope `args`: `{ reason: str, severity: "low" | "medium" | "high" }`
  - mutação: cria uma notificação para usuários com papel SUPERVISOR do
    workspace (tabela de notificações), grava `tool_logs`. NÃO muda
    `conversations.ai_mode` nem `status`.
  - resposta: `{ ok, content, payload?: { notified } }`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class EscalateArgs(BaseModel):
    """Argumentos para escalar a um supervisor."""

    reason: str = Field(
        description="Por que o caso precisa de um supervisor, em uma frase.",
        min_length=1,
        max_length=500,
    )
    severity: Literal["low", "medium", "high"] = Field(
        default="medium",
        description=(
            "Gravidade da situação: 'low' (atenção), 'medium' (precisa de ação), "
            "'high' (urgente — risco de perda do cliente ou reclamação grave)."
        ),
    )


class EscalateTool(CallbackTool):
    key = "escalate"
    name = "Escalar para supervisor"
    description = (
        "Notifica um supervisor humano sobre a conversa, sem sair do atendimento. "
        "Use para casos sensíveis (reclamação grave, risco de churn, decisão acima "
        "da sua alçada) em que alguém da equipe precisa acompanhar. Continue "
        "atendendo normalmente após escalar."
    )
    category = "workflow"
    Args = EscalateArgs
