"""init_pool: boot resiliente com retry/backoff (evita o exit-3 no deploy)."""

from __future__ import annotations

import asyncio

import asyncpg
import pytest

import app.db as db


@pytest.fixture(autouse=True)
def _reset_pool():
    db._pool = None
    yield
    db._pool = None


def test_init_pool_retries_until_postgres_ready(monkeypatch) -> None:
    """Postgres 'starting up' nas 2 primeiras tentativas → sucesso na 3ª, sem crash."""
    calls = {"create": 0, "sleep": 0}
    sentinel = object()

    async def fake_create_pool(*_a: object, **_k: object) -> object:
        calls["create"] += 1
        if calls["create"] < 3:
            raise ConnectionRefusedError("Connection refused")
        return sentinel

    async def fake_sleep(_s: float) -> None:
        calls["sleep"] += 1

    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)
    monkeypatch.setattr(db.asyncio, "sleep", fake_sleep)

    pool = asyncio.run(db.init_pool())

    assert pool is sentinel
    assert calls["create"] == 3
    assert calls["sleep"] == 2  # dormiu entre as 2 falhas, não após o sucesso


def test_init_pool_raises_after_exhausting_attempts(monkeypatch) -> None:
    """Indisponibilidade real (todas as tentativas falham) → propaga o erro."""
    calls = {"create": 0}

    async def always_fail(*_a: object, **_k: object) -> object:
        calls["create"] += 1
        raise ConnectionRefusedError("Connection refused")

    async def fake_sleep(_s: float) -> None:
        return None

    monkeypatch.setattr(asyncpg, "create_pool", always_fail)
    monkeypatch.setattr(db.asyncio, "sleep", fake_sleep)

    with pytest.raises(ConnectionRefusedError):
        asyncio.run(db.init_pool())

    assert calls["create"] == db._POOL_INIT_MAX_ATTEMPTS


def test_init_pool_is_idempotent(monkeypatch) -> None:
    """Pool já inicializado é retornado sem nova tentativa de conexão."""
    existing = object()
    db._pool = existing  # type: ignore[assignment]

    async def boom(*_a: object, **_k: object) -> object:
        raise AssertionError("create_pool não deveria ser chamado")

    monkeypatch.setattr(asyncpg, "create_pool", boom)

    assert asyncio.run(db.init_pool()) is existing
