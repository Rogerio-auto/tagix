"""Testes do EmbeddingsProvider e do endpoint /internal/embed (F3-S02).

Sem rede real: `httpx.MockTransport` injeta respostas determinísticas da OpenAI
(mesmo padrão de test_providers_openrouter). O log de uso em `llm_usage_logs` é
verificado via monkeypatch (sem DB real).
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

import app.routes.embed as embed_module
from app.providers.embeddings import (
    EmbeddingsAuthError,
    EmbeddingsError,
    EmbeddingsProvider,
)


def _make_provider(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    max_retries: int = 2,
) -> EmbeddingsProvider:
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    return EmbeddingsProvider(client=client, max_retries=max_retries)


def _embeddings_payload(n: int, *, dim: int = 1536, total_tokens: int = 8) -> dict:
    return {
        "object": "list",
        "model": "text-embedding-3-small",
        "data": [
            {"object": "embedding", "index": i, "embedding": [0.01 * (i + 1)] * dim}
            for i in range(n)
        ],
        "usage": {"prompt_tokens": total_tokens, "total_tokens": total_tokens},
    }


# ----------------------------------------------------------------- provider
async def test_embed_returns_1536_dim_vectors() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        n = len(captured["body"]["input"])
        return httpx.Response(200, json=_embeddings_payload(n))

    provider = _make_provider(handler)
    result = await provider.embed(["alpha", "beta"])

    assert captured["url"].endswith("/v1/embeddings")
    assert captured["body"]["model"] == "text-embedding-3-small"
    assert captured["body"]["dimensions"] == 1536
    assert len(result.embeddings) == 2
    assert all(len(v) == 1536 for v in result.embeddings)
    assert result.usage.total_tokens == 8
    assert result.usage.total_cost_usd > 0


async def test_embed_preserves_order_by_index() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        # Devolve fora de ordem de propósito; o provider reordena por index.
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [0.2] * 1536},
                    {"index": 0, "embedding": [0.1] * 1536},
                ],
                "usage": {"total_tokens": 4},
                "model": "text-embedding-3-small",
            },
        )

    provider = _make_provider(handler)
    result = await provider.embed(["a", "b"])
    assert result.embeddings[0][0] == pytest.approx(0.1)
    assert result.embeddings[1][0] == pytest.approx(0.2)


async def test_embed_empty_short_circuits() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("não deveria chamar a OpenAI para lista vazia")

    provider = _make_provider(handler)
    result = await provider.embed([])
    assert result.embeddings == []
    assert result.usage.total_tokens == 0


async def test_embed_dimension_mismatch_raises() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_embeddings_payload(1, dim=512))

    provider = _make_provider(handler)
    with pytest.raises(EmbeddingsError):
        await provider.embed(["x"])


async def test_embed_auth_error_not_retried() -> None:
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    provider = _make_provider(handler, max_retries=2)
    with pytest.raises(EmbeddingsAuthError):
        await provider.embed(["x"])
    assert calls["n"] == 1  # auth não passa por retry


async def test_embed_retries_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": {"message": "rate"}})
        n = len(json.loads(request.content)["input"])
        return httpx.Response(200, json=_embeddings_payload(n))

    provider = _make_provider(handler, max_retries=2)
    result = await provider.embed(["x"])
    assert calls["n"] == 2
    assert len(result.embeddings) == 1


# ----------------------------------------------------------------- endpoint
def _client(monkeypatch, *, provider: EmbeddingsProvider, logged: list) -> TestClient:
    from app.main import create_app

    async def fake_log_usage(workspace_id, model, total_tokens, cost_usd) -> None:
        logged.append((workspace_id, model, total_tokens, cost_usd))

    monkeypatch.setattr(embed_module, "_log_usage", fake_log_usage)

    app = create_app()
    app.state.embeddings_provider = provider
    return TestClient(app)


def test_endpoint_requires_token(monkeypatch) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:  # pragma: no cover
        return httpx.Response(200, json=_embeddings_payload(1))

    logged: list = []
    client = _client(monkeypatch, provider=_make_provider(handler), logged=logged)
    resp = client.post("/internal/embed", json={"workspace_id": "ws", "texts": ["a"]})
    assert resp.status_code == 401


def test_endpoint_rejects_empty_texts(monkeypatch) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:  # pragma: no cover
        return httpx.Response(200, json=_embeddings_payload(0))

    logged: list = []
    client = _client(monkeypatch, provider=_make_provider(handler), logged=logged)
    resp = client.post(
        "/internal/embed",
        json={"workspace_id": "ws", "texts": []},
        headers={"Authorization": "Bearer test-internal-token"},
    )
    assert resp.status_code == 422  # validação Pydantic (min_length=1)


def test_endpoint_embeds_and_logs_usage(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        n = len(json.loads(request.content)["input"])
        return httpx.Response(200, json=_embeddings_payload(n))

    logged: list = []
    client = _client(monkeypatch, provider=_make_provider(handler), logged=logged)
    resp = client.post(
        "/internal/embed",
        json={"workspace_id": "11111111-1111-1111-1111-111111111111", "texts": ["a", "b"]},
        headers={"Authorization": "Bearer test-internal-token"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["embeddings"]) == 2
    assert all(len(v) == 1536 for v in body["embeddings"])
    assert body["model"] == "text-embedding-3-small"
    assert body["usage"]["total_tokens"] == 8
    assert len(logged) == 1
    assert logged[0][0] == "11111111-1111-1111-1111-111111111111"


def test_endpoint_502_on_upstream_failure(monkeypatch) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": {"message": "boom"}})

    logged: list = []
    client = _client(monkeypatch, provider=_make_provider(handler, max_retries=0), logged=logged)
    resp = client.post(
        "/internal/embed",
        json={"workspace_id": "11111111-1111-1111-1111-111111111111", "texts": ["a"]},
        headers={"Authorization": "Bearer test-internal-token"},
    )
    assert resp.status_code == 502
    assert logged == []
