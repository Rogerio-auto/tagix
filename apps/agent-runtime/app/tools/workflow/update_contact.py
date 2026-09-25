"""Tool `update_contact` — atualiza campos permitidos do contato da conversa.

> **Slot:** F70-S15.

Tool de workflow (callback Node). O alvo é SEMPRE o contato da conversa (o Node o
resolve pela conversa do envelope, sob RLS) — não há `contact_id` nos args.

Allowlist estrita, espelhada nos dois lados (aqui `extra="forbid"`; no Node um Zod
`.strict()`): nome de exibição, idioma, fuso e campos personalizados (merge). Nunca
telefone, e-mail, dono, workspace, consentimento/opt-in, documento ou endereço —
esses mudam identidade de canal, deduplicação ou base legal de contato, e não são
decisão do modelo.

Contrato Node (`POST /internal/tools/update_contact`):
  - envelope `args`: só os campos que o modelo informou (`exclude_unset`);
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
        description="Nome pelo qual o contato quer ser chamado.",
        min_length=1,
        max_length=200,
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
            "Chaves em snake_case minúsculo; valores texto, número, booleano ou null."
        ),
        max_length=20,
    )


class UpdateContactTool(CallbackTool):
    key = "update_contact"
    name = "Atualizar contato"
    description = (
        "Atualiza dados do contato desta conversa: nome de exibição, idioma, fuso "
        "horário e campos personalizados. Telefone, e-mail e consentimento NÃO podem "
        "ser alterados por aqui."
    )
    category = "workflow"
    Args = UpdateContactArgs

    def _envelope(self, args: BaseModel, ctx: ToolContext) -> dict[str, Any]:
        """Só os campos que o modelo informou: `None` de default não vira escrita."""
        envelope = super()._envelope(args, ctx)
        envelope["args"] = args.model_dump(mode="json", exclude_unset=True)
        return envelope
