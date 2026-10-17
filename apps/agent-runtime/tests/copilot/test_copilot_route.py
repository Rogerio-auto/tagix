"""`POST /copilot/run`: auth, validação, SSE, timeout, desconexão e zero banco."""

from __future__ import annotations

import ast
import asyncio
import contextlib
from pathlib import Path
from typing import Any

import pytest
from copilot_fakes import (
    HANG,
    RUNTIME_TOKEN,
    FakeNode,
    ScriptedProvider,
    answer_script,
    build_graph,
    json_responder,
    ok_envelope,
    parse_frames,
    request_body,
    tool_call_script,
    types_of,
    with_policy,
)
from fastapi.testclient import TestClient

import app.db as db_module
from app.config import get_settings
from app.copilot.route import stream_copilot_turn

AUTH = {"Authorization": f"Bearer {RUNTIME_TOKEN}"}
ANSWER = {
    "verdict": "Três negócios parados.",
    "why": [],
    "data_refs": ["r-deals-1"],
    "sources": [],
    "next_steps": [],
}


class ExplodingPool:
    """Pool que falha se alguém tentar usá-lo: o caminho do Copiloto não abre conexão."""

    def __init__(self) -> None:
        self.acquired = 0

    def acquire(self) -> Any:
        self.acquired += 1
        raise AssertionError("o caminho /copilot/run não pode abrir conexão de banco")


def _client(graph: Any | None) -> TestClient:
    from app.main import create_app

    app = create_app()
    if graph is not None:
        app.state.copilot_graph = graph
    return TestClient(app)  # sem `with`: o lifespan (pool real) não roda


def _happy_graph() -> tuple[Any, FakeNode]:
    node = FakeNode({"list_deals": json_responder(ok_envelope())})
    provider = ScriptedProvider(
        [tool_call_script("list_deals", {"idle_days": 7}), answer_script(ANSWER)]
    )
    return build_graph(provider, node), node


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def test_requires_runtime_token() -> None:
    graph, _ = _happy_graph()
    client = _client(graph)
    assert client.post("/copilot/run", json=request_body()).status_code == 401
    bad = {"Authorization": "Bearer wrong-token"}
    assert client.post("/copilot/run", json=request_body(), headers=bad).status_code == 401


def test_graph_not_initialized_is_503() -> None:
    resp = _client(None).post("/copilot/run", json=request_body(), headers=AUTH)
    assert resp.status_code == 503


@pytest.mark.parametrize(
    "descriptor",
    [
        {"key": "deal.move", "description": "x", "parameters": {"type": "object"}},
        {"key": "answer", "description": "x", "parameters": {"type": "object"}},
        {"key": "list_deals", "description": "x", "parameters": {"type": "array"}},
        {"key": "list_deals", "description": "", "parameters": {"type": "object"}},
        {"key": "list_deals", "description": "x", "parameters": {"type": "object"}, "extra": 1},
    ],
    ids=["dotted-key", "reserved-answer", "non-object-schema", "empty-description", "extra"],
)
def test_invalid_tool_descriptor_is_422(descriptor: dict[str, Any]) -> None:
    graph, node = _happy_graph()
    resp = _client(graph).post("/copilot/run", json=request_body(tools=[descriptor]), headers=AUTH)
    assert resp.status_code == 422
    assert node.requests == []


@pytest.mark.parametrize(
    "override",
    [
        {"unknown_field": True},
        {"turn_id": "not-a-uuid"},
        {"now_iso": "2026-10-16T09:30:00"},  # sem fuso
        {"history": [{"role": "user", "content": "x"}] * 13},
        {"user_input": ""},
    ],
    ids=["extra-field", "bad-uuid", "naive-datetime", "history-too-long", "empty-input"],
)
def test_invalid_request_is_422(override: dict[str, Any]) -> None:
    graph, _ = _happy_graph()
    resp = _client(graph).post("/copilot/run", json=request_body(**override), headers=AUTH)
    assert resp.status_code == 422


def test_duplicate_tool_keys_are_422() -> None:
    graph, _ = _happy_graph()
    tools = [request_body()["tools"][0]] * 2
    resp = _client(graph).post("/copilot/run", json=request_body(tools=tools), headers=AUTH)
    assert resp.status_code == 422


def test_sse_stream_end_to_end_without_touching_the_database(monkeypatch) -> None:
    pool = ExplodingPool()
    monkeypatch.setattr(db_module, "_pool", pool)
    graph, node = _happy_graph()

    resp = _client(graph).post("/copilot/run", json=request_body(), headers=AUTH)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    frames = [f + "\n\n" for f in resp.text.split("\n\n") if f]
    events = parse_frames(frames)
    assert types_of(events)[0] == "status"
    assert types_of(events)[-1] == "final"
    assert events[-1]["blocks"]["data_refs"] == ["r-deals-1"]
    assert len(node.requests) == 1
    assert pool.acquired == 0


def test_copilot_package_never_imports_the_database_layer() -> None:
    """Prova estática do ADR-003 §6: nada em `app/copilot` importa `app.db`/`asyncpg`."""
    package = Path(__file__).resolve().parents[2] / "app" / "copilot"
    offenders: list[str] = []
    for path in package.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            offenders += [
                f"{path.name}: {n}"
                for n in names
                if n == "asyncpg" or n.startswith("app.db") or n.startswith("app.tools.database")
            ]
    assert offenders == []


# ---------------------------------------------------------------------------
# Timeout e cancelamento
# ---------------------------------------------------------------------------


async def test_turn_timeout_emits_timeout_error_and_cancels_the_model() -> None:
    provider = ScriptedProvider([HANG])
    graph = build_graph(provider, FakeNode({}))
    req = with_policy(turn_timeout_s=1)  # mínimo do contrato (int ≥ 1)

    frames = [f async for f in stream_copilot_turn(graph, req, get_settings())]
    events = parse_frames(frames)

    assert types_of(events) == ["verdict_delta", "error"]
    assert events[-1] == {"type": "error", "code": "timeout"}
    assert provider.cancelled.is_set()


async def test_client_disconnect_cancels_the_graph_task() -> None:
    """O Starlette cancela a tarefa que consome o gerador quando o cliente cai."""
    provider = ScriptedProvider([HANG])
    graph = build_graph(provider, FakeNode({}))
    stream = stream_copilot_turn(graph, with_policy(turn_timeout_s=60), get_settings())
    received: list[str] = []

    async def consume() -> None:
        async for frame in stream:
            received.append(frame)

    async def first_frame() -> None:
        while not received:
            await asyncio.sleep(0.01)

    consumer = asyncio.create_task(consume())
    await asyncio.wait_for(provider.hanging.wait(), timeout=2)
    await asyncio.wait_for(first_frame(), timeout=2)
    consumer.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await consumer

    await asyncio.wait_for(provider.cancelled.wait(), timeout=2)
    assert len(received) == 1  # só o verdict_delta antes da queda
    assert "final" not in "".join(received)


async def test_closing_the_stream_cancels_the_graph_task() -> None:
    provider = ScriptedProvider([HANG])
    graph = build_graph(provider, FakeNode({}))
    stream = stream_copilot_turn(graph, with_policy(turn_timeout_s=60), get_settings())

    first = await anext(stream)
    assert '"verdict_delta"' in first
    await stream.aclose()
    await asyncio.wait_for(provider.cancelled.wait(), timeout=2)


async def test_unexpected_graph_failure_becomes_internal_error() -> None:
    class BrokenGraph:
        async def astream(self, *_a: Any, **_k: Any):
            yield {"type": "status", "tool_key": "list_deals"}
            raise RuntimeError("boom")

    frames = [f async for f in stream_copilot_turn(BrokenGraph(), with_policy(), get_settings())]
    events = parse_frames(frames)
    assert events == [
        {"type": "status", "tool_key": "list_deals"},
        {"type": "error", "code": "internal"},
    ]


async def test_graph_ending_without_terminal_event_becomes_internal_error() -> None:
    class SilentGraph:
        async def astream(self, *_a: Any, **_k: Any):
            if False:  # pragma: no cover
                yield {}

    frames = [f async for f in stream_copilot_turn(SilentGraph(), with_policy(), get_settings())]
    assert parse_frames(frames) == [{"type": "error", "code": "internal"}]
