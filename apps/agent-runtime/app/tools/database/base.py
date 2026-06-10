"""Base das tools "leves" de DB (executam direto via asyncpg sob RLS).

> **Slot:** F2-S06 — `docs/AGENTS_LANGGRAPH.md` §6.2, §6.5.

`DatabaseTool` carrega o pool asyncpg (injetado na construção, nunca serializa) e
fornece o helper `_query_one` que centraliza a sequência de segurança:

  1. `with_workspace(conn, ctx.workspace_id)` → transação sob role `hm_app` + RLS.
  2. `safe_columns(requested, policy)` → monta a lista de colunas do SELECT
     contra o allowlist de leitura (deny-by-default).
  3. `project(dict(row), policy)` → última barreira de exfiltração na row de volta.

Nomes de coluna NUNCA são interpolados a partir de input do modelo sem passar por
`safe_columns` (que só deixa passar identificadores do allowlist estático da
policy). Valores (ids) viajam sempre como parâmetros vinculados ($1, $2).
"""

from __future__ import annotations

from typing import Any

import asyncpg

from app.db import with_workspace
from app.logging import get_logger
from app.tools.access_control import ColumnAccessError, ColumnPolicy, project, safe_columns
from app.tools.base import Tool, ToolContext

logger = get_logger()


class DatabaseTool(Tool):
    """Tool que executa direto no Postgres sob RLS de workspace.

    Subclasses declaram `table` + `default_handler_config` (ACL de coluna) e
    implementam `_run`. Usam `self._query_one(...)` para SELECTs seguros.
    """

    category = "database"

    def __init__(
        self,
        pool: asyncpg.Pool,
        handler_config: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(handler_config)
        self._pool = pool

    def with_config(self, handler_config: dict[str, Any]) -> DatabaseTool:
        clone = type(self).__new__(type(self))
        clone.__dict__.update(self.__dict__)
        clone._handler_config = {
            **type(self).default_handler_config,
            **handler_config,
        }
        return clone

    async def _query_one(
        self,
        ctx: ToolContext,
        *,
        requested: list[str],
        from_clause: str,
        where: str,
        params: list[Any],
        policy: ColumnPolicy | None = None,
    ) -> dict[str, Any] | None:
        """SELECT de uma linha sob RLS, com colunas filtradas pela ACL + projeção.

        `requested` são as colunas pedidas (já fornecidas/derivadas dos args). Elas
        passam por `safe_columns` (allowlist de leitura). `where`/`params` usam
        placeholders posicionais ($1...). Retorna a row já projetada (ou `None`).
        """
        pol = policy or self.policy()
        log_ctx = {"tool": self.key, "workspace": ctx.workspace_id}
        cols = safe_columns(requested, pol, access="read", log_context=log_ctx)
        if not cols:
            raise ColumnAccessError(
                "nenhuma coluna legível resolvida para a tool",
                table=pol.table,
                columns=requested,
            )

        select_list = ", ".join(cols)
        sql = f"SELECT {select_list} FROM {from_clause} WHERE {where} LIMIT 1"

        async with self._pool.acquire() as conn:
            async with with_workspace(conn, ctx.workspace_id) as scoped:
                row = await scoped.fetchrow(sql, *params)

        return project(dict(row) if row is not None else None, pol, log_context=log_ctx)
