"""Pool asyncpg + helper RLS `with_workspace`.

Fundação multi-tenant das tools "leves" (F2-S06). Espelha o `withWorkspace` do
`@hm/db` (TS): abre uma transação, troca para o papel `hm_app` (sujeito a RLS) e
seta `app.workspace_id` com `SET LOCAL` — o escopo dura só a transação.

Mantido enxuto de propósito: o checkpointer Postgres do LangGraph (F2-S05) usa
sua própria conexão psycopg e NÃO compartilha este pool.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Final

import asyncpg

from app.config import get_settings
from app.logging import get_logger

logger = get_logger()

_pool: asyncpg.Pool | None = None

# Boot resiliente: no deploy (build + migrations concorrentes) o Postgres fica
# transitoriamente indisponível ou "starting up" no exato instante do startup do
# runtime → `create_pool` estourava e o container morria (exit 3), o que fazia o
# Swarm reverter o serviço para a imagem anterior. Retry com backoff cobre a janela
# de contenção sem mascarar uma indisponibilidade real (após o teto, propaga o erro).
_POOL_INIT_MAX_ATTEMPTS: Final[int] = 20
_POOL_INIT_RETRY_DELAY_S: Final[float] = 2.0


async def init_pool() -> asyncpg.Pool:
    """Cria o pool asyncpg (idempotente, com retry no boot). Chamado no startup do FastAPI."""
    global _pool
    if _pool is not None:
        return _pool

    settings = get_settings()
    for attempt in range(1, _POOL_INIT_MAX_ATTEMPTS + 1):
        try:
            _pool = await asyncpg.create_pool(
                dsn=settings.asyncpg_dsn,
                min_size=settings.db_pool_min_size,
                max_size=settings.db_pool_max_size,
                command_timeout=30.0,
            )
            if attempt > 1:
                logger.info(f"asyncpg pool inicializado (tentativa {attempt})")
            else:
                logger.info("asyncpg pool inicializado")
            return _pool
        except (OSError, asyncpg.PostgresError) as exc:
            if attempt == _POOL_INIT_MAX_ATTEMPTS:
                logger.error(
                    f"asyncpg pool indisponível após {_POOL_INIT_MAX_ATTEMPTS} tentativas: {exc}"
                )
                raise
            logger.warning(
                f"asyncpg pool indisponível (tentativa {attempt}/{_POOL_INIT_MAX_ATTEMPTS}), "
                f"retry em {_POOL_INIT_RETRY_DELAY_S}s: {exc}"
            )
            await asyncio.sleep(_POOL_INIT_RETRY_DELAY_S)

    # Inalcançável (o loop retorna ou levanta), mas satisfaz o type checker.
    raise RuntimeError("init_pool: estado inalcançável")


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
