"""Tool `query_conversation` — lê o estado da conversa atual (§7.1).

Leve: SELECT direto sob RLS + ACL de coluna. Read-only.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.tools.base import ToolContext, ToolResult
from app.tools.database.base import DatabaseTool

_DEFAULT_READ = ["status", "ai_mode", "assigned_to", "department_id", "kind"]


class QueryConversationArgs(BaseModel):
    """Sem argumentos: opera sobre a conversa do contexto."""


class QueryConversationTool(DatabaseTool):
    key = "query_conversation"
    name = "Consultar conversa"
    description = "Lê o estado da conversa atual (status, modo IA, atribuição, departamento)."
    table = "conversations"
    Args = QueryConversationArgs
    default_handler_config = {
        "table": "conversations",
        "allowed_columns": {"read": list(_DEFAULT_READ), "write": []},
        "restricted_columns": [],
        "required_columns": [],
    }

    async def _run(self, args: QueryConversationArgs, ctx: ToolContext) -> ToolResult:
        if ctx.conversation_id is None:
            return ToolResult(ok=False, error="Não há conversa no contexto atual.")

        if ctx.is_playground:
            return ToolResult(
                ok=True,
                content="(simulado) Conversa aberta, modo IA ligado.",
                payload={"simulated": True, "status": "open", "ai_mode": "on"},
            )

        row = await self._query_one(
            ctx,
            requested=list(_DEFAULT_READ),
            from_clause="conversations",
            where="id = $1",
            params=[ctx.conversation_id],
        )
        if row is None:
            return ToolResult(ok=True, content="Conversa não encontrada.", payload=None)
        return ToolResult(ok=True, payload=row)
