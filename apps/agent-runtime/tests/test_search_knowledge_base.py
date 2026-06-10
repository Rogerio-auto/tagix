"""Testes do retrieval real de search_knowledge_base (F3-S05).

asyncpg + EmbeddingsProvider mockados. Cobre: ranking combinado, base vazia,
citações no payload, caminho de playground e falha de embed.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from app.providers.embeddings import EmbeddingResult, EmbeddingsError, EmbeddingUsage
from app.tools.base import ToolContext
from app.tools.database import _kb_retrieval
from app.tools.database.search_knowledge_base import (
    SearchKnowledgeBaseArgs,
    SearchKnowledgeBaseTool,
)


class FakeConn:
    """Conexao asyncpg falsa: `fetch` devolve linhas pre-carregadas."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self.last_query: str | None = None
        self.last_params: tuple[Any, ...] = ()

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, sql: str, *params: Any) -> str:
        self.executed.append((sql, params))
        return "OK"

    async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        self.last_query = sql
        self.last_params = params
        return self._rows


class FakePool:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.conn = FakeConn(rows or [])

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class FakeProvider:
    """EmbeddingsProvider falso: devolve um vetor fixo 1536-dim."""

    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail

    async def embed(self, texts: list[str]) -> EmbeddingResult:
        if self._fail:
            raise EmbeddingsError("upstream down")
        return EmbeddingResult(
            embeddings=[[0.01] * 1536 for _ in texts],
            model="text-embedding-3-small",
            usage=EmbeddingUsage(total_tokens=3, total_cost_usd=0.0),
        )


def _row(
    *, chunk_id: str, doc_id: str, title: str, vsim: float, fts: float, priority: int, fb: int
):
    return {
        "chunk_id": chunk_id,
        "document_id": doc_id,
        "title": title,
        "content": f"conteudo de {title}",
        "vector_sim": vsim,
        "fts_rank": fts,
        "priority": priority,
        "feedback_score": fb,
    }


def _ctx(**over: Any) -> ToolContext:
    base: dict[str, Any] = {
        "workspace_id": "11111111-1111-1111-1111-111111111111",
        "agent_id": "agent-1",
        "execution_id": "exec-1",
    }
    base.update(over)
    return ToolContext(**base)


# --------------------------------------------------------------- retrieval helper
async def test_retrieve_ranks_by_combined_score() -> None:
    rows = [
        _row(chunk_id="c1", doc_id="d1", title="Baixa", vsim=0.5, fts=0.0, priority=0, fb=0),
        _row(chunk_id="c2", doc_id="d2", title="Alta", vsim=0.9, fts=0.5, priority=10, fb=3),
    ]
    pool = FakePool(rows)
    out = await _kb_retrieval.retrieve(
        pool,  # type: ignore[arg-type]
        workspace_id="ws-1",
        query_embedding=[0.01] * 1536,
        query_text="pergunta",
        k=5,
    )
    assert [c.chunk_id for c in out] == ["c2", "c1"]  # maior score primeiro
    assert out[0].document_id == "d2"
    assert out[0].score > out[1].score


async def test_retrieve_sets_workspace_rls() -> None:
    pool = FakePool([])
    await _kb_retrieval.retrieve(
        pool,  # type: ignore[arg-type]
        workspace_id="ws-xyz",
        query_embedding=[0.0] * 1536,
        query_text="q",
        k=3,
    )
    # with_workspace deve ter setado role + app.workspace_id.
    execs = " ".join(sql for sql, _ in pool.conn.executed)
    assert "SET LOCAL ROLE hm_app" in execs
    assert "set_config" in execs


# --------------------------------------------------------------- tool _run
async def test_tool_returns_citations() -> None:
    rows = [
        _row(chunk_id="c2", doc_id="d2", title="Politica", vsim=0.9, fts=0.4, priority=8, fb=2),
    ]
    tool = SearchKnowledgeBaseTool(FakePool(rows), embeddings_provider=FakeProvider())
    res = await tool._run(SearchKnowledgeBaseArgs(query="qual a politica?", k=5), _ctx())
    assert res.ok is True
    assert res.payload["indexed"] is True
    results = res.payload["results"]
    assert len(results) == 1
    assert results[0]["document_id"] == "d2"
    assert results[0]["chunk_id"] == "c2"
    assert "Politica" in res.content


async def test_tool_empty_base_is_not_error() -> None:
    tool = SearchKnowledgeBaseTool(FakePool([]), embeddings_provider=FakeProvider())
    res = await tool._run(SearchKnowledgeBaseArgs(query="nada", k=5), _ctx())
    assert res.ok is True
    assert res.payload == {"results": [], "indexed": True}


async def test_tool_playground_short_circuits() -> None:
    # Sem pool/provider reais: o caminho playground nao deve tocar nenhum deles.
    tool = SearchKnowledgeBaseTool()
    res = await tool._run(SearchKnowledgeBaseArgs(query="x", k=5), _ctx(is_playground=True))
    assert res.ok is True
    assert res.payload["indexed"] is True
    assert res.payload.get("simulated") is True


async def test_tool_embed_failure_is_graceful() -> None:
    tool = SearchKnowledgeBaseTool(FakePool([]), embeddings_provider=FakeProvider(fail=True))
    res = await tool._run(SearchKnowledgeBaseArgs(query="x", k=5), _ctx())
    assert res.ok is False
    assert res.error is not None

