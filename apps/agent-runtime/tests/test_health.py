"""Smoke do /health: 200 com DB up, 503 com DB down. Pool é mockado (sem DB real)."""

from __future__ import annotations

from fastapi.testclient import TestClient

import app.db as db
import app.health as health
from app.main import create_app


def _client_without_lifespan() -> TestClient:
    """Client que NÃO dispara o lifespan (não inicializa pool real)."""
    app = create_app()
    client = TestClient(app)
    # TestClient como context manager rodaria o lifespan (pool real); evitamos isso.
    return client


def test_health_ok_when_db_pings(monkeypatch) -> None:
    async def fake_ping() -> bool:
        return True

    monkeypatch.setattr(health, "ping", fake_ping)

    client = _client_without_lifespan()
    resp = client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "up"
    assert "version" in body


def test_health_503_when_db_down(monkeypatch) -> None:
    async def fake_ping() -> bool:
        raise RuntimeError("pool não inicializado")

    monkeypatch.setattr(health, "ping", fake_ping)

    client = _client_without_lifespan()
    resp = client.get("/health")

    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "unhealthy"
    assert body["database"] == "down"


def test_ping_uses_pool(monkeypatch) -> None:
    """`ping()` executa SELECT 1 e devolve True quando o pool retorna 1."""

    class _Conn:
        async def fetchval(self, _sql: str) -> int:
            return 1

    class _Acquire:
        async def __aenter__(self) -> _Conn:
            return _Conn()

        async def __aexit__(self, *_exc: object) -> None:
            return None

    class _Pool:
        def acquire(self) -> _Acquire:
            return _Acquire()

    import asyncio

    assert asyncio.run(db.ping(_Pool())) is True  # type: ignore[arg-type]
