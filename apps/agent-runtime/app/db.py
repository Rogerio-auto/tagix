"""Pool asyncpg + helper RLS `with_workspace`.

Fundação multi-tenant das tools "leves" (F2-S06). Espelha o `withWorkspace` do
`@hm/db` (TS): abre uma transação, troca para o papel `hm_app` (sujeito a RLS) e
seta `app.workspace_id` com `SET LOCAL` — o escopo dura só a transação.

Mantido enxuto de propósito: o checkpointer Postgres do LangGraph (F2-S05) usa
sua própria conexão psycopg e NÃO compartilha este pool.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg

from app.config import get_settings
from app.logging import get_logger

logger = get_logger()

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    """Cria o pool asyncpg (idempotente). Chamado no startup do FastAPI."""
    global _pool
    if _pool is not None:
        return _pool

    settings = get_settings()
    _pool = await asyncpg.create_pool(
        dsn=settings.asyncpg_dsn,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        command_timeout=30.0,
    )
    logger.info("asyncpg pool inicializado")
    return _pool


async def close_pool() -> None:
    """Fecha o pool no shutdown do FastAPI."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("asyncpg pool encerrado")


def get_pool() -> asyncpg.Pool:
    """Retorna o pool já inicializado. Erro se chamado antes do startup."""
    if _pool is None:
        raise RuntimeError("asyncpg pool não inicializado — chame init_pool() no startup")
    return _pool


async def ping(pool: asyncpg.Pool | None = None) -> bool:
    """Healthcheck do banco: `SELECT 1`. Usado por `GET /health`."""
    pool = pool or get_pool()
    async with pool.acquire() as conn:
        result = await conn.fetchval("SELECT 1")
    return result == 1


@asynccontextmanager
async def with_workspace(
    conn: asyncpg.Connection,
    workspace_id: str,
) -> AsyncIterator[asyncpg.Connection]:
    """Escopa `conn` a um workspace sob RLS, dentro de uma transação.

    Espelha o `withWorkspace(workspaceId, fn)` do `@hm/db`:

      - `SET LOCAL ROLE hm_app`  -> papel da app, sujeito às policies RLS.
      - `set_config('app.workspace_id', <id>, true)` -> `SET LOCAL`; escopo
        limitado à transação (terceiro arg `true` = local).

    Uso (tools leves, F2-S06):

        async with pool.acquire() as conn:
            async with with_workspace(conn, ctx.workspace_id) as conn:
                row = await conn.fetchrow("SELECT ... FROM contacts WHERE id = $1", cid)

    O `workspace_id` é passado como parâmetro vinculado (nunca interpolado) —
    sem superfície de SQL injection.
    """
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE hm_app")
        await conn.execute(
            "SELECT set_config('app.workspace_id', $1, true)",
            workspace_id,
        )
        yield conn
