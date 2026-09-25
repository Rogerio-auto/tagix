"""Tool `update_contact` — atualiza campos permitidos do contato da conversa.

> **Slot:** F70-S15.

Tool de workflow (callback Node). O alvo é SEMPRE o contato da conversa (o Node o
resolve pela conversa do envelope, sob RLS) — não há `contact_id` nos args.

Allowlist estrita, espelhada nos dois lados (aqui `extra="forbid"`; no Node um Zod
`.strict()`): nome de exibição, idioma, fuso e campos personalizados (merge). Nunca
telefone, e-mail, dono, workspace, consentimento/opt-in, documento ou endereço —
esses mudam identidade de canal, deduplicação ou base legal de contato, e não são
decisão do modelo.

F70-S23: cada chave de `custom_fields` tem de estar liberada para o agente
(`custom_fields_write_keys` em `agent_tools.overrides`; vazio por padrão = nenhuma), e
`display_name` é uma linha só, sem colchetes/sinais de delimitação, até 80 caracteres
(ele volta ao prompt em todo turno). As duas regras são do Node.

Contrato Node (`POST /internal/tools/update_contact`):
  - envelope `args`: só os campos que o modelo informou com valor (`exclude_unset` e
    sem `null`: `null` significa "não informado" dos dois lados);
  - mutação: `contacts` (merge em `custom_fields`), grava `tool_logs`;
  - resposta: `{ ok, content, payload?: { updated: [...] } }`; campo fora da
    allowlist → `ok: false`, nada escrito.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.tools.base import ToolContext
from app.tools.callback import CallbackTool

CustomFieldKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]
CustomFieldValue = Annotated[str, StringConstraints(max_length=500)] | float | bool | None


class UpdateContactArgs(BaseModel):
    """Campos editáveis do contato. Informe só o que mudou."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(
        default=None,
        description=(
            "Nome pelo qual o contato quer ser chamado: uma linha, sem colchetes, "
            "até 80 caracteres."
        ),
        min_length=1,
        max_length=80,
    )
    language: str | None = Field(
        default=None,
        description="Idioma preferido (BCP 47, ex.: 'pt-BR', 'es', 'en-US').",
        pattern=r"^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$",
    )
    timezone: str | None = Field(
        default=None,
        description="Fuso horário IANA do contato (ex.: 'America/Sao_Paulo').",
        min_length=1,
        max_length=64,
    )
    custom_fields: dict[CustomFieldKey, CustomFieldValue] | None = Field(
        default=None,
        description=(
            "Campos personalizados a gravar (merge: só as chaves informadas mudam). "
            "Só chaves liberadas para você; as demais são recusadas. "
            "Chaves em snake_case minúsculo; valores texto, número, booleano ou null."
        ),
        max_length=20,
    )


class UpdateContactTool(CallbackTool):
    key = "update_contact"
    name = "Atualizar contato"
    description = (
        "Atualiza dados do contato desta conversa: nome de exibição, idioma, fuso "
        "horário e os campos personalizados liberados para você. Telefone, e-mail e "
        "consentimento NÃO podem ser alterados por aqui."
    )
    category = "workflow"
    Args = UpdateContactArgs

    def _envelope(self, args: BaseModel, ctx: ToolContext) -> dict[str, Any]:
        """Só os campos que o modelo informou com valor: `None` nunca vira escrita.

        `null` explícito do modelo (o schema aceita) é "não informado", como no Node.
        Dentro de `custom_fields`, `null` é valor e segue (limpa a chave).
        """
        envelope = super()._envelope(args, ctx)
        envelope["args"] = {
            key: value
            for key, value in args.model_dump(mode="json", exclude_unset=True).items()
            if value is not None
        }
        return envelope
