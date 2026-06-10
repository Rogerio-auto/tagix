"""Checkpointer Postgres do LangGraph (AsyncPostgresSaver).

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.4.

O grafo persiste o `AgentState` a cada transição de node nas tabelas `checkpoints*`
do LangGraph (criadas por `setup()` no boot). Isso dá resiliência + retomada de
`interrupt` (human-in-the-loop, `POST /resume`).

Decisão deliberada: este saver usa a **própria conexão psycopg** a partir de
`settings.database_url`. NÃO compartilha o pool asyncpg de `app/db.py` (que é da
camada de negócio sob RLS `hm_app`). As tabelas de checkpoint são infra do
LangGraph e rodam com o papel de migração padrão da conexão.

`setup()` é idempotente; chamamos UMA vez no startup do FastAPI (a rota é montada
pelo orquestrador). O `AsyncPostgresSaver.from_conn_string(...)` é um *async
context manager* — em produção o lifespan o mantém aberto pelo processo todo.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.config import get_settings
from app.logging import get_logger

logger = get_logger()


def _conn_string() -> str:
    """DSN psycopg para o checkpointer.

    psycopg aceita o DSN `postgresql://...`. O `asyncpg_dsn` de settings já é a
    string normalizada (sem `+driver`), então serve para ambos.
    """
    return get_settings().asyncpg_dsn


@asynccontextmanager
async def lifespan_checkpointer() -> AsyncIterator[AsyncPostgresSaver]:
    """Abre o saver para o tempo de vida do processo e roda `setup()` uma vez.

    Uso no lifespan do FastAPI (montagem feita pelo orquestrador):

        async with lifespan_checkpointer() as saver:
            app.state.graph = build_graph(tool_registry=registry, checkpointer=saver)
            yield

    A conexão psycopg é aberta/fechada pelo context manager — sem leaks.
    """
    async with AsyncPostgresSaver.from_conn_string(_conn_string()) as saver:
        await saver.setup()
        logger.info("langgraph checkpointer pronto (tabelas verificadas)")
        yield saver


async def build_checkpointer() -> AsyncPostgresSaver:
    """Cria + faz `setup()` de um saver e devolve a INSTÂNCIA aberta.

    Variante sem context manager para quem gerencia o ciclo de vida manualmente
    (ex.: scripts, testes de integração). Em produção prefira
    `lifespan_checkpointer()`, que garante o fechamento.

    O caller é responsável por fechar a conexão subjacente no shutdown.
    """
    cm = AsyncPostgresSaver.from_conn_string(_conn_string())
    saver = await cm.__aenter__()
    await saver.setup()
    # Guarda o context manager no próprio saver para o caller poder fechar depois.
    saver._hm_cm = cm  # type: ignore[attr-defined]
    logger.info("langgraph checkpointer pronto (tabelas verificadas)")
    return saver
