"""Tool `move_deal_stage` — move o deal do contato para outro estágio (F5-S08).

Tool de workflow (callback Node): a regra de negócio — validação de transition
rules, escrita de `deal_history` e disparo de automações — é *single source of
truth* no Node, que reusa `moveDealToStage` (F5-S05). O Python NÃO duplica
nenhuma regra; só declara o contrato e delega via callback.

Spec: docs/features/PIPELINE.md §11; docs/AGENTS_LANGGRAPH.md §6.3/§7.

## Contrato Node (`POST /internal/tools/move_deal_stage`)

  - envelope `args`: `{ stage_id: str, deal_id: str | None }` (deal_id opcional;
    o Node resolve o deal aberto do contato se ausente).
  - mutação: move via `moveDealToStage` com `actor.type='agent'`
    (transition rules + deal_history + seam de automação/socket no servidor).
  - resposta: `{ ok, content?, error?, payload?: { deal_id?, from_stage_id?,
    to_stage_id? } }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class MoveDealStageArgs(BaseModel):
    """Argumentos para mover um deal de estágio."""

    stage_id: str = Field(
        description=(
            "ID do estágio (stage) destino, dentro do mesmo pipeline do deal. "
            "Use exatamente um dos IDs de estágio disponíveis no contexto."
        ),
        min_length=1,
    )
    deal_id: str | None = Field(
        default=None,
        description=(
            "ID do deal a mover. Opcional: se omitido, o servidor move o negócio "
            "aberto mais recente do contato atual."
        ),
    )


class MoveDealStageTool(CallbackTool):
    key = "move_deal_stage"
    name = "Mover negócio de estágio"
    description = (
        "Move o negócio (deal) do contato para outro estágio do funil. Use quando "
        "a conversa indica progresso (ex.: cliente agendou visita, fechou compra). "
        "A validação de regras de transição e o histórico são aplicados no servidor."
    )
    category = "workflow"
    Args = MoveDealStageArgs
