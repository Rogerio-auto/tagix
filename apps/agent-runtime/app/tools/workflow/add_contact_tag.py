"""Tool `add_contact_tag` — aplica uma etiqueta existente ao contato da conversa.

> **Slot:** F70-S15.

Tool de workflow (callback Node). O alvo é SEMPRE o contato da conversa (o Node o
resolve pela conversa do envelope, sob RLS) — não há `contact_id` nos args.

Só etiquetas que já existem no workspace: o modelo não cria etiqueta. Etiqueta é
controle (ex.: `atendimento-humano` pausa a cadência; `tag_added` dispara flows),
então o vocabulário é do operador, não do modelo.

F70-S23: além de existir, a etiqueta tem de estar LIBERADA para o agente
(`allowed_tags` em `agent_tools.overrides`; vazio por padrão = nenhuma). Etiqueta que
registra conversão só é aplicada se o agente puder registrar conversões. A decisão é
do Node, com a config lida do banco; este lado não amplia nem restringe nada.

Contrato Node (`POST /internal/tools/add_contact_tag`):
  - envelope `args`: `{ tag: str }` (nome da etiqueta; nada além disso)
  - mutação: `contact_tags` (idempotente), grava `tool_logs`.
  - resposta: `{ ok, content, payload?: { tagId, applied } }`; etiqueta
    inexistente ou não liberada → `ok: false` com a lista das liberadas.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.tools.callback import CallbackTool


class AddContactTagArgs(BaseModel):
    """Argumentos: só o nome da etiqueta."""

    model_config = ConfigDict(extra="forbid")

    tag: str = Field(
        description=(
            "Nome exato de uma etiqueta liberada para você "
            "(ex.: 'atendimento-humano'). Não invente etiquetas novas."
        ),
        min_length=1,
        max_length=80,
    )


class AddContactTagTool(CallbackTool):
    key = "add_contact_tag"
    name = "Etiquetar contato"
    description = (
        "Aplica ao contato desta conversa uma etiqueta que o operador liberou para você "
        "(ex.: 'atendimento-humano' quando uma pessoa da equipe precisa assumir). Não "
        "cria etiquetas: etiqueta inexistente ou não liberada é recusada."
    )
    category = "workflow"
    Args = AddContactTagArgs
