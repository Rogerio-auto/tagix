"""Tool `query_contact` — lê dados do contato atual da conversa (§7.1).

Leve: SELECT direto sob RLS + ACL de coluna. Sem efeitos colaterais (read-only).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.base import ToolContext, ToolResult
from app.tools.database.base import DatabaseTool

# Whitelist seed de leitura (espelha tools.handler_config; o Node sobrepõe por
# workspace em produção). `restricted`/baseline negam o resto por padrão.
_DEFAULT_READ = ["display_name", "email", "phone", "language", "source", "custom_fields"]


class QueryContactArgs(BaseModel):
    """Args do `query_contact`. O modelo escolhe QUAIS campos quer ler."""

    fields: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_READ),
        description="Campos do contato a consultar (apenas os permitidos retornam).",
    )


class QueryContactTool(DatabaseTool):
    key = "query_contact"
    name = "Consultar contato"
    description = "Lê dados do contato atual da conversa (nome, e-mail, telefone, etc.)."
    table = "contacts"
    Args = QueryContactArgs
    default_handler_config = {
        "table": "contacts",
        "allowed_columns": {"read": list(_DEFAULT_READ), "write": []},
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
        return ToolResult(ok=True, payload=row)
