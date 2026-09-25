"""Tool `query_contact` — lê dados do contato atual da conversa (§7.1).

Leve: SELECT direto sob RLS + ACL de coluna. Sem efeitos colaterais (read-only).

F70-S15 (PII para o provedor de LLM):
  - telefone e e-mail saíram da leitura PADRÃO. Continuam no teto
    (`max_handler_config`): um operador pode liberá-los para um agente específico
    por `agent_tools.overrides`, mas nada além do teto entra.
  - `custom_fields` só devolve as chaves de `custom_fields_keys` (default: nenhuma),
    com valores escalares e texto cortado — nunca o JSONB inteiro.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.access_control import custom_fields_keys, filter_custom_fields
from app.tools.base import ToolContext, ToolResult
from app.tools.database.base import DatabaseTool

# Leitura padrão (espelha tools.handler_config do catálogo). Sem telefone/e-mail.
_DEFAULT_READ = ["display_name", "language", "source", "custom_fields"]
# Teto: o máximo que a config por agente pode liberar. `restricted`/baseline negam o resto.
_CEILING_READ = ["display_name", "email", "phone", "language", "source", "custom_fields"]


class QueryContactArgs(BaseModel):
    """Args do `query_contact`. O modelo escolhe QUAIS campos quer ler."""

    fields: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_READ),
        description="Campos do contato a consultar (apenas os permitidos retornam).",
    )


class QueryContactTool(DatabaseTool):
    key = "query_contact"
    name = "Consultar contato"
    description = (
        "Lê dados do contato atual da conversa (nome, idioma, origem e os campos "
        "personalizados liberados para este agente)."
    )
    table = "contacts"
    Args = QueryContactArgs
    default_handler_config = {
        "table": "contacts",
        "allowed_columns": {"read": list(_DEFAULT_READ), "write": []},
        "restricted_columns": ["notes"],
        "required_columns": [],
        "custom_fields_keys": [],
    }
    max_handler_config = {
        "table": "contacts",
        "allowed_columns": {"read": list(_CEILING_READ), "write": []},
        "restricted_columns": ["notes"],
        "required_columns": [],
    }

    async def _run(self, args: QueryContactArgs, ctx: ToolContext) -> ToolResult:
        if ctx.contact_id is None:
            return ToolResult(
                ok=False,
                error="Não há contato associado a esta conversa.",
            )

        if ctx.is_playground:
            return ToolResult(
                ok=True,
                content="(simulado) Contato de exemplo.",
                payload={"simulated": True, "display_name": "Maria Exemplo"},
            )

        requested = args.fields or list(_DEFAULT_READ)
        row = await self._query_one(
            ctx,
            requested=requested,
            from_clause="contacts",
            where="id = $1 AND deleted_at IS NULL",
            params=[ctx.contact_id],
        )
        if row is None:
            return ToolResult(ok=True, content="Contato não encontrado.", payload=None)
        if "custom_fields" in row:
            row["custom_fields"] = filter_custom_fields(
                row["custom_fields"], custom_fields_keys(self.handler_config)
            )
        return ToolResult(ok=True, payload=row)
