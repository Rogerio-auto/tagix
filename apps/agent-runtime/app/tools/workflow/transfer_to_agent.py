"""Tool `transfer_to_agent` — transfere a conversa para OUTRO agente de IA (F34-S05/S06).

Tool de workflow (callback Node): o efeito de negócio — fixar
`conversations.agent_id = targetAgentId` (sticky) e re-engajar a IA do novo agente —
é *single source of truth* no Node (`apps/api/src/internal/tools/agent-transfer-handlers.ts`),
sob authz de alvo (o agente atual e o destino precisam compartilhar ≥1 departamento).
Esta subclasse só declara metadados + `Args`; o transporte HTTP, auth e normalização
vivem em `CallbackTool` (F2-S07).

Contrato de args — **fonte da verdade é o handler Node** (`transferToAgentArgs` Zod):
  - `targetAgentId: str` (uuid, obrigatório)
  - `reason: str | None` (1..500, opcional)

Convenção de wire: o contrato dessa tool é camelCase de propósito — ele casa 1:1 o
Zod `{ targetAgentId, reason? }` que o Node valida no envelope `args`. O
`CallbackTool._envelope` serializa via `model_dump(mode="json")` (sem `by_alias`), então
o **nome do campo Pydantic é o que vai no wire** — por isso o campo se chama
`targetAgentId` (não `target_agent_id`): sem alias, sem reescrita de chave.

Contrato Node (`POST /internal/tools/transfer_to_agent`):
  - mutação (só se elegível): `conversations.agent_id = targetAgentId`, enfileira
    `flow.run.requested` (re-engaje), grava `tool_logs`. No-op gracioso se o alvo já
    é o agente atual. Authz de alvo (same-dept) rejeita destino inválido SEM efeito.
  - resposta: `{ ok, content, payload? }`. O `content` já instrui a IA a parar de
    responder ("Conversa transferida... Pare de responder.") — a tool só repassa.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class TransferToAgentArgs(BaseModel):
    """Argumentos que a LLM deve fornecer para transferir a conversa a outro agente.

    O nome de cada campo é o nome de wire (o `CallbackTool._envelope` serializa via
    `model_dump(mode="json")`, sem `by_alias`). `targetAgentId`/`reason` casam 1:1 o
    Zod `transferToAgentArgs` do Node — a FONTE DA VERDADE do contrato (S05).
    """

    targetAgentId: str = Field(  # noqa: N815 — nome de wire (contrato Zod do Node)
        description=(
            "ID (UUID) do agente de IA de destino — deve ser um dos pares listados no "
            "system prompt. Transferir para fora dessa lista é rejeitado pelo sistema."
        ),
    )
    reason: str | None = Field(
        default=None,
        description=(
            "Motivo da transferência, em uma frase (registrado para auditoria e para "
            "dar contexto ao agente que assume). Opcional, mas recomendado."
        ),
        min_length=1,
        max_length=500,
    )


class TransferToAgentTool(CallbackTool):
    key = "transfer_to_agent"
    name = "Transferir para outro agente de IA"
    description = (
        "Passa a conversa para OUTRO agente de IA especializado (um dos pares do seu "
        "departamento listados no prompt). Use quando o assunto é melhor atendido por "
        "outro agente (ex.: cobrança → agente Financeiro). Após transferir, NÃO responda "
        "mais — o outro agente assume a partir daqui."
    )
    category = "workflow"
    Args = TransferToAgentArgs
