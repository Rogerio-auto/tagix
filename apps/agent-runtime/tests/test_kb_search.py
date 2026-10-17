"""`POST /kb/search` (F73-S04): busca no conhecimento para o Node, com pool e embeddings fakes."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.providers.embeddings import EmbeddingResult, EmbeddingsError, EmbeddingUsage
from app.routes.kb_search import (
    SNIPPET_MAX_CHARS,
    get_embeddings_provider,
    get_kb_pool,
    make_snippet,
)

AUTH = {"Authorization": "Bearer test-internal-token"}
WS = "11111111-1111-1111-1111-111111111111"


class FakeConn:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self.fetch_params: tuple[Any, ...] = ()

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, sql: str, *params: Any) -> str:
        self.executed.append((sql, params))
        return "OK"

    async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        self.fetch_params = params
        return self._rows


class FakePool:
    def __init__(self, rows: list[dict[str, Any]] | None = None, *, fail: bool = False) -> None:
        self.conn = FakeConn(rows or [])
        self._fail = fail

    @asynccontextmanager
    async def acquire(self):
        if self._fail:
            raise OSError("db down")
        yield self.conn


class FakeEmbeddings:
    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail
        self.texts: list[list[str]] = []

    async def embed(self, texts: list[str]) -> EmbeddingResult:
        self.texts.append(texts)
        if self._fail:
            raise EmbeddingsError("upstream down")
        return EmbeddingResult(
            embeddings=[[0.01] * 1536 for _ in texts],
            model="text-embedding-3-small",
            usage=EmbeddingUsage(total_tokens=3, total_cost_usd=0.0),
        )


def _row(chunk: str, doc: str, title: str, vsim: float, content: str = "") -> dict[str, Any]:
    return {
        "chunk_id": chunk,
        "document_id": doc,
        "title": title,
        "content": content or f"conteúdo de {title}",
        "vector_sim": vsim,
        "fts_rank": 0.0,
        "priority": 0,
        "feedback_score": 0,
    }


def _client(pool: FakePool, embeddings: FakeEmbeddings) -> TestClient:
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[get_kb_pool] = lambda: pool
    app.dependency_overrides[get_embeddings_provider] = lambda: embeddings
    return TestClient(app)


def test_requires_runtime_token() -> None:
    client = _client(FakePool(), FakeEmbeddings())
    resp = client.post("/kb/search", json={"workspace_id": WS, "query": "x"})
    assert resp.status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"workspace_id": WS, "query": "x", "limit": 9},
        {"workspace_id": WS, "query": "x" * 501},
        {"workspace_id": WS, "query": ""},
        {"workspace_id": "nope", "query": "x"},
        {"workspace_id": WS, "query": "x", "extra": True},
    ],
    ids=["limit>8", "query>500", "empty-query", "bad-uuid", "extra-field"],
)
def test_invalid_body_is_422(body: dict[str, Any]) -> None:
    embeddings = FakeEmbeddings()
    resp = _client(FakePool(), embeddings).post("/kb/search", json=body, headers=AUTH)
    assert resp.status_code == 422
    assert embeddings.texts == []


def test_whitespace_only_query_is_422() -> None:
    resp = _client(FakePool(), FakeEmbeddings()).post(
        "/kb/search", json={"workspace_id": WS, "query": "   "}, headers=AUTH
    )
    assert resp.status_code == 422


def test_search_returns_best_chunk_per_document_under_rls() -> None:
    long_text = "Política de troca: " + ("o cliente pode trocar o alinhador em até 30 dias. " * 30)
    rows = [
        _row("c1", "d1", "Trocas", 0.91, long_text),
        _row("c2", "d1", "Trocas", 0.80),  # mesmo documento, pior trecho
        _row("c3", "d2", "Garantia", 0.70),
        _row("c4", "d3", "Preços", 0.50),
    ]
    pool, embeddings = FakePool(rows), FakeEmbeddings()
    resp = _client(pool, embeddings).post(
        "/kb/search", json={"workspace_id": WS, "query": "  política de troca  ", "limit": 2},
        headers=AUTH,
    )

    assert resp.status_code == 200
    results = resp.json()["results"]
    assert [r["document_id"] for r in results] == ["d1", "d2"]
    assert results[0]["title"] == "Trocas"
    assert len(results[0]["snippet"]) <= SNIPPET_MAX_CHARS
    assert results[0]["snippet"].endswith("…")
    assert results[0]["score"] > results[1]["score"]
    assert set(results[0]) == {"document_id", "title", "snippet", "score"}

    # A query vai normalizada ao embedding e ao FTS; o retrieval roda sob with_workspace.
    assert embeddings.texts == [["política de troca"]]
    assert pool.conn.fetch_params[1] == "política de troca"
    executed = " ".join(sql for sql, _ in pool.conn.executed)
    assert "SET LOCAL ROLE hm_app" in executed
    assert ("SELECT set_config('app.workspace_id', $1, true)", (WS,)) in pool.conn.executed


def test_empty_base_returns_empty_results() -> None:
    resp = _client(FakePool([]), FakeEmbeddings()).post(
        "/kb/search", json={"workspace_id": WS, "query": "nada"}, headers=AUTH
    )
    assert resp.status_code == 200
    assert resp.json() == {"results": []}


def test_embedding_failure_is_502() -> None:
    resp = _client(FakePool([]), FakeEmbeddings(fail=True)).post(
        "/kb/search", json={"workspace_id": WS, "query": "x"}, headers=AUTH
    )
    assert resp.status_code == 502
    assert "upstream down" not in resp.text


def test_database_failure_is_503() -> None:
    resp = _client(FakePool(fail=True), FakeEmbeddings()).post(
        "/kb/search", json={"workspace_id": WS, "query": "x"}, headers=AUTH
    )
    assert resp.status_code == 503
    assert "db down" not in resp.text


def test_make_snippet_bounds() -> None:
    assert make_snippet("  a \n b  ") == "a b"
    long = make_snippet("palavra " * 200)
    assert len(long) <= SNIPPET_MAX_CHARS and long.endswith("…")
    assert len(make_snippet("x" * 2000)) == SNIPPET_MAX_CHARS
