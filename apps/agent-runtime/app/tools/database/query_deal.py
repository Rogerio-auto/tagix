"""Tool `query_deal` — lê o deal aberto do contato atual da conversa (F5-S08).

Leve: SELECT direto sob RLS + ACL de coluna (deny-by-default), espelhando
`query_contact`. Read-only, sem efeito colateral. Retorna o deal aberto mais
recente do contato (o caso de uso do agente: "em que estágio o cliente está?").

Spec: docs/features/PIPELINE.md §11; docs/AGENTS_LANGGRAPH.md §6/§7.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.base import ToolContext, ToolResult
from app.tools.database.base import DatabaseTool

# Whitelist seed de leitura do deal. O Node sobrepõe por workspace em produção.
_DEFAULT_READ = [
    "id",
    "title",
    "stage_id",
    "pipeline_id",
    "value_cents",
    "currency",
    "source",
    "custom_fields",
]


class QueryDealArgs(BaseModel):
    """Args do `query_deal`. O modelo escolhe QUAIS campos quer ler."""

    fields: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_READ),
        description="Campos do deal a consultar (apenas os permitidos retornam).",
    )


class QueryDealTool(DatabaseTool):
    key = "query_deal"
    name = "Consultar negócio (deal)"
    description = (
        "Lê o negócio (deal) aberto do contato atual: estágio, valor, pipeline e "
        "campos personalizados. Use para saber em que etapa do funil o cliente está."
    )
    table = "deals"
    Args = QueryDealArgs
    default_handler_config = {
        "table": "deals",
        "allowed_columns": {"read": list(_DEFAULT_READ), "write": []},
        "restricted_columns": ["notes"],
        "required_columns": [],
    }

    async def _run(self, args: QueryDealArgs, ctx: ToolContext) -> ToolResult:
        if ctx.contact_id is None:
            return ToolResult(
                ok=False,
                error="Não há contato associado a esta conversa.",
            )

        if ctx.is_playground:
            return ToolResult(
                ok=True,
                content="(simulado) Deal de exemplo no estágio 'Qualificação'.",
                payload={"simulated": True, "title": "Negócio de exemplo"},
            )

        requested = args.fields or list(_DEFAULT_READ)
        # Deal aberto mais recente do contato (closed_at IS NULL).
        row = await self._query_one(
            ctx,
            requested=requested,
            from_clause="deals",
            where="contact_id = $1 AND closed_at IS NULL ORDER BY created_at DESC",
            params=[ctx.contact_id],
        )
        if row is None:
            return ToolResult(
                ok=True,
                content="Nenhum negócio aberto encontrado para este contato.",
                payload=None,
            )
        return ToolResult(ok=True, payload=row)
