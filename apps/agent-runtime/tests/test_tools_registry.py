"""Testes do registry + base Tool + tools leves de DB (F2-S06).

asyncpg é mockado (sem DB real): um fake pool/conn captura o SQL e devolve rows
controladas, validando que a sequência with_workspace → safe_columns → project é
aplicada e que o contrato com o grafo (specs_for / dispatch) se mantém.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import pytest
from pydantic import BaseModel, Field

from app.tools.base import Tool, ToolContext, ToolResult
from app.tools.database import build_light_db_tools
from app.tools.database.query_contact import QueryContactTool
from app.tools.database.query_conversation import QueryConversationTool
from app.tools.registry import ToolRegistry, build_default_registry

# ---------------------------------------------------------------------------
# Fakes asyncpg (sem DB real)
# ---------------------------------------------------------------------------


class FakeConn:
    """Conexão asyncpg falsa: registra execs e o último SQL/params do fetchrow."""

    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self.last_query: str | None = None
        self.last_params: tuple[Any, ...] = ()

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, sql: str, *params: Any) -> str:
        self.executed.append((sql, params))
        return "OK"

    async def fetchrow(self, sql: str, *params: Any):
        self.last_query = sql
        self.last_params = params
        return self._row


class FakePool:
    """Pool asyncpg falso: `acquire()` devolve uma `FakeConn` pré-carregada."""

    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self.conn = FakeConn(row)

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _ctx(**over: Any) -> dict[str, Any]:
    base = {
        "workspace_id": "ws-1",
        "conversation_id": "conv-1",
        "contact_id": "contact-1",
        "agent_id": "agent-1",
        "execution_id": "exec-1",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# openai_schema / specs_for
# ---------------------------------------------------------------------------


def test_openai_schema_shape() -> None:
    tool = QueryContactTool(FakePool())
    schema = tool.openai_schema()
    assert schema["type"] == "function"
    fn = schema["function"]
    assert fn["name"] == "query_contact"
    assert isinstance(fn["description"], str) and fn["description"]
    assert "properties" in fn["parameters"]  # JSON Schema do Pydantic


def test_specs_for_filters_and_orders() -> None:
    reg = build_default_registry(FakePool())
    all_specs = reg.specs_for(None)
    keys = [s["function"]["name"] for s in all_specs]
    assert keys == sorted(keys)  # ordem estável
    assert {"query_contact", "query_conversation", "search_knowledge_base"} <= set(keys)

    only = reg.specs_for({"query_contact"})
    assert [s["function"]["name"] for s in only] == ["query_contact"]

    none = reg.specs_for(set())
    assert none == []


def test_registry_register_duplicate_and_override() -> None:
    reg = ToolRegistry()
    t = QueryContactTool(FakePool())
    reg.register(t)
    with pytest.raises(ValueError):
        reg.register(t)
    reg.register(t, override=True)  # ok
    assert reg.has("query_contact")
    assert "query_contact" in reg
    assert len(reg) == 1


# ---------------------------------------------------------------------------
# dispatch — contrato com o grafo
# ---------------------------------------------------------------------------


async def test_dispatch_unknown_tool() -> None:
    reg = build_default_registry(FakePool())
    out = await reg.dispatch("does_not_exist", {}, _ctx())
    assert out == {"ok": False, "content": "", "error": out["error"]}
    assert out["ok"] is False and out["error"]


async def test_dispatch_invalid_context() -> None:
    reg = build_default_registry(FakePool())
    # falta workspace_id obrigatório
    out = await reg.dispatch("query_conversation", {}, {"agent_id": "a"})
    assert out["ok"] is False
    assert "ontexto" in out["error"] or "inválid" in out["error"].lower()


async def test_dispatch_query_contact_projects_allowed_columns() -> None:
    # row do DB inclui uma coluna NÃO permitida (notes) — project deve removê-la.
    pool = FakePool(
        row={"display_name": "Ana", "phone": "+5511999999999", "notes": "secreto"}
    )
    reg = build_default_registry(pool)
    out = await reg.dispatch(
        "query_contact", {"fields": ["display_name", "phone", "notes"]}, _ctx()
    )
    assert out["ok"] is True
    assert "notes" not in out["content"]
    assert "display_name" in out["content"]
    # SELECT só pediu colunas permitidas (notes é restricted → fora do SQL)
    assert "notes" not in (pool.conn.last_query or "")
    assert "display_name" in (pool.conn.last_query or "")


async def test_query_contact_runs_under_workspace_rls() -> None:
    pool = FakePool(row={"display_name": "Ana"})
    reg = build_default_registry(pool)
    await reg.dispatch("query_contact", {"fields": ["display_name"]}, _ctx())
    execs = [sql for sql, _ in pool.conn.executed]
    assert any("SET LOCAL ROLE hm_app" in s for s in execs)
    assert any("set_config('app.workspace_id'" in s for s in execs)
    # workspace_id viajou como parâmetro vinculado
    set_cfg = next(p for s, p in pool.conn.executed if "set_config" in s)
    assert set_cfg == ("ws-1",)


async def test_query_contact_no_contact_in_context() -> None:
    reg = build_default_registry(FakePool())
    out = await reg.dispatch("query_contact", {}, _ctx(contact_id=None))
    assert out["ok"] is False
    assert out["error"]


async def test_query_contact_only_disallowed_fields_denied() -> None:
    # pede só colunas fora do allowlist → ColumnAccessError → ok=False seguro
    pool = FakePool(row={"display_name": "Ana"})
    reg = build_default_registry(pool)
    out = await reg.dispatch("query_contact", {"fields": ["api_token_hash", "notes"]}, _ctx())
    assert out["ok"] is False
    assert "negado" in out["error"].lower() or "acesso" in out["error"].lower()


async def test_query_conversation_returns_state() -> None:
    pool = FakePool(row={"status": "open", "ai_mode": "on", "assigned_to": None})
    reg = build_default_registry(pool)
    out = await reg.dispatch("query_conversation", {}, _ctx())
    assert out["ok"] is True
    assert "open" in out["content"]


async def test_query_conversation_no_conversation() -> None:
    reg = build_default_registry(FakePool())
    out = await reg.dispatch("query_conversation", {}, _ctx(conversation_id=None))
    assert out["ok"] is False


async def test_search_kb_empty_base_returns_empty() -> None:
    # F3-S05: a tool faz retrieval real. Com a base vazia (fetch -> []) e um
    # provider de embeddings injetado, devolve resultados vazios sem erro.
    from app.providers.embeddings import EmbeddingResult, EmbeddingUsage
    from app.tools.database.search_knowledge_base import SearchKnowledgeBaseTool

    class _EmptyConn:
        @asynccontextmanager
        async def transaction(self):
            yield

        async def execute(self, sql: str, *params: Any) -> str:
            return "OK"

        async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
            return []

    class _EmptyPool:
        @asynccontextmanager
        async def acquire(self):
            yield _EmptyConn()

    class _FakeProvider:
        async def embed(self, texts: list[str]) -> EmbeddingResult:
            return EmbeddingResult(
                embeddings=[[0.01] * 1536 for _ in texts],
                model="text-embedding-3-small",
                usage=EmbeddingUsage(total_tokens=1, total_cost_usd=0.0),
            )

    tool = SearchKnowledgeBaseTool(_EmptyPool(), embeddings_provider=_FakeProvider())
    out = await tool.execute({"query": "preço do plano"}, ToolContext(**_ctx()))
    assert out.ok is True
    assert out.payload == {"results": [], "indexed": True}


async def test_search_kb_invalid_args() -> None:
    reg = build_default_registry(FakePool())
    # query obrigatório ausente
    out = await reg.dispatch("search_knowledge_base", {}, _ctx())
    assert out["ok"] is False
    assert "rgument" in out["error"] or "inválid" in out["error"].lower()


# ---------------------------------------------------------------------------
# Playground (efeitos colaterais simulados)
# ---------------------------------------------------------------------------


async def test_query_contact_playground_simulates() -> None:
    pool = FakePool(row={"display_name": "NaoDeveSerLido"})
    reg = build_default_registry(pool)
    out = await reg.dispatch("query_contact", {}, _ctx(is_playground=True))
    assert out["ok"] is True
    assert pool.conn.last_query is None  # não tocou o DB


# ---------------------------------------------------------------------------
# Base Tool — validação de declaração e fronteira de erro
# ---------------------------------------------------------------------------


class _GoodArgs(BaseModel):
    x: int = Field(default=1)


class _RaisingTool(Tool):
    key = "boom"
    name = "Boom"
    description = "explode"
    category = "workflow"
    Args = _GoodArgs

    async def _run(self, args: Any, ctx: ToolContext) -> ToolResult:
        raise RuntimeError("kaboom with secret +5511988887777")


async def test_execute_swallows_runtime_error_without_leaking() -> None:
    tool = _RaisingTool()
    ctx = ToolContext(workspace_id="ws", agent_id="a", execution_id="e")
    result = await tool.execute({}, ctx)
    assert result.ok is False
    assert "kaboom" not in (result.error or "")
    assert "5511" not in (result.error or "")


def test_incomplete_subclass_rejected() -> None:
    class _Incomplete(Tool):
        key = "x"
        name = "x"
        description = "x"
        category = "workflow"
        # falta Args

        async def _run(self, args: Any, ctx: ToolContext) -> ToolResult:
            return ToolResult(ok=True)

    with pytest.raises(TypeError):
        _Incomplete()


def test_with_config_does_not_mutate_original() -> None:
    pool = FakePool()
    tool = QueryContactTool(pool)
    original = dict(tool.handler_config)
    clone = tool.with_config({"allowed_columns": {"read": ["display_name"], "write": []}})
    assert clone.policy().allowed("read") == frozenset({"display_name"})
    assert tool.handler_config == original  # intacta


def test_build_light_db_tools_count() -> None:
    tools = build_light_db_tools(FakePool())
    keys = {t.key for t in tools}
    assert keys == {"query_contact", "query_deal", "query_conversation", "search_knowledge_base"}
    assert isinstance(tools[0], (QueryContactTool, QueryConversationTool, Tool))
