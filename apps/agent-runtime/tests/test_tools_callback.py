"""Testes do `CallbackTool` (transporte Python → Node) — F2-S07.

Sem rede real: `httpx.MockTransport` injeta respostas determinísticas e captura
a requisição (URL, header de auth, envelope). Cobre: sucesso, erro HTTP (status
>=400 não vaza corpo do Node), timeout, resposta não-JSON, e o curto-circuito de
playground.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from pydantic import BaseModel

from app.tools.base import ToolContext
from app.tools.callback import CallbackTool


class _Args(BaseModel):
    reason: str
    department_id: str | None = None


class _TransferTool(CallbackTool):
    key = "transfer_to_human"
    name = "Transferir para humano"
    description = "Entrega a conversa a um atendente humano."
    category = "workflow"
    Args = _Args


def _ctx(*, is_playground: bool = False) -> ToolContext:
    return ToolContext(
        workspace_id="ws-1",
        conversation_id="conv-1",
        agent_id="agent-1",
        execution_id="exec-1",
        is_playground=is_playground,
    )


def _make_tool(
    handler: Callable[[httpx.Request], httpx.Response],
) -> _TransferTool:
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    return _TransferTool(client=client)


@pytest.mark.asyncio
async def test_success_posts_envelope_and_auth_header() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"ok": True, "content": "transferido", "payload": {"x": 1}}
        )

    tool = _make_tool(handler)
    result = await tool.execute({"reason": "preço"}, _ctx())

    assert result.ok is True
    assert result.content == "transferido"
    assert result.payload == {"x": 1}
    assert captured["url"].endswith("/internal/tools/transfer_to_human")  # type: ignore[union-attr]
    assert captured["auth"] == "Bearer test-internal-token"
    assert captured["body"] == {
        "workspace_id": "ws-1",
        "conversation_id": "conv-1",
        "agent_id": "agent-1",
        "execution_id": "exec-1",
        "args": {"reason": "preço", "department_id": None},
    }


@pytest.mark.asyncio
async def test_http_error_does_not_leak_node_body() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "stack-trace-secret"})

    tool = _make_tool(handler)
    result = await tool.execute({"reason": "x"}, _ctx())

    assert result.ok is False
    assert result.error is not None
    assert "secret" not in result.error
    assert "transfer_to_human" in result.error


@pytest.mark.asyncio
async def test_timeout_returns_safe_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    tool = _make_tool(handler)
    result = await tool.execute({"reason": "x"}, _ctx())

    assert result.ok is False
    assert result.error is not None
    assert "esgotado" in result.error.lower()


@pytest.mark.asyncio
async def test_non_json_response_is_handled() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json")

    tool = _make_tool(handler)
    result = await tool.execute({"reason": "x"}, _ctx())

    assert result.ok is False
    assert result.error is not None


@pytest.mark.asyncio
async def test_playground_short_circuits_callback() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = _make_tool(handler)
    result = await tool.execute({"reason": "x"}, _ctx(is_playground=True))

    assert result.ok is True
    assert called is False
    assert result.payload == {"simulated": True}


@pytest.mark.asyncio
async def test_invalid_args_never_call_node() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = _make_tool(handler)
    # `reason` é obrigatório → ValidationError capturado por `execute`.
    result = await tool.execute({}, _ctx())

    assert result.ok is False
    assert called is False
