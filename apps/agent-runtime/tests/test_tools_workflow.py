"""Testes das tools de workflow (F2-S20).

Sem rede real: `httpx.MockTransport` injeta respostas e captura a requisição
(URL, header de auth, envelope). Cobre, para cada tool de workflow:
  - o `toolKey` correto na URL e o envelope serializado certo;
  - schema OpenAI exposto (a LLM lê `description` + `parameters`);
  - validação de `Args` (campos obrigatórios) antes de qualquer callback;
  - `register_workflow_tools` registra todas no registry;
  - `register_conversion`: curto-circuito de policy (defense-in-depth) e o
    caminho "não suportado ainda" (resposta do Node repassada).
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from app.tools.base import ToolContext
from app.tools.registry import ToolRegistry
from app.tools.workflow import (
    ChangeConversationStatusTool,
    EscalateTool,
    MarkResolvedTool,
    RegisterConversionTool,
    TransferToHumanTool,
    build_workflow_tools,
    register_workflow_tools,
)

_ALL_KEYS = {
    "transfer_to_human",
    "transfer_to_agent",
    "escalate",
    "mark_resolved",
    "change_conversation_status",
    "register_conversion",
    "move_deal_stage",
}


def _ctx(*, is_playground: bool = False) -> ToolContext:
    return ToolContext(
        workspace_id="ws-1",
        conversation_id="conv-1",
        contact_id="contact-1",
        agent_id="agent-1",
        execution_id="exec-1",
        is_playground=is_playground,
    )


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok_handler(captured: dict[str, object]) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "content": "feito"})

    return handler


# --------------------------------------------------------------------------- meta
def test_all_tools_declare_workflow_category_and_keys() -> None:
    tools = build_workflow_tools(httpx.AsyncClient())
    assert {t.key for t in tools} == _ALL_KEYS
    for t in tools:
        assert t.category == "workflow"
        assert t.name and t.description
        schema = t.openai_schema()
        assert schema["function"]["name"] == t.key
        assert "parameters" in schema["function"]


def test_register_workflow_tools_registers_all() -> None:
    registry = ToolRegistry()
    returned = register_workflow_tools(registry, httpx.AsyncClient())
    assert returned is registry
    assert _ALL_KEYS <= registry.keys()
    assert len(registry) == len(_ALL_KEYS)


# ------------------------------------------------------------------ per-tool wire
@pytest.mark.asyncio
async def test_transfer_to_human_posts_envelope() -> None:
    captured: dict[str, object] = {}
    tool = TransferToHumanTool(client=_client(_ok_handler(captured)))
    result = await tool.execute(
        {"reason": "cliente pediu humano", "department_id": "dep-9"}, _ctx()
    )
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/transfer_to_human")
    assert captured["auth"] == "Bearer test-internal-token"
    assert captured["body"] == {
        "workspace_id": "ws-1",
        "conversation_id": "conv-1",
        "agent_id": "agent-1",
        "execution_id": "exec-1",
        "args": {"reason": "cliente pediu humano", "department_id": "dep-9"},
    }


@pytest.mark.asyncio
async def test_escalate_envelope_and_default_severity() -> None:
    captured: dict[str, object] = {}
    tool = EscalateTool(client=_client(_ok_handler(captured)))
    result = await tool.execute({"reason": "reclamação grave"}, _ctx())
    assert result.ok is True
    body = captured["body"]
    assert isinstance(body, dict)
    assert str(captured["url"]).endswith("/internal/tools/escalate")
    assert body["args"] == {"reason": "reclamação grave", "severity": "medium"}


@pytest.mark.asyncio
async def test_mark_resolved_envelope() -> None:
    captured: dict[str, object] = {}
    tool = MarkResolvedTool(client=_client(_ok_handler(captured)))
    result = await tool.execute({"resolution": "pedido enviado"}, _ctx())
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/mark_resolved")
    assert captured["body"]["args"] == {"resolution": "pedido enviado"}  # type: ignore[index]


@pytest.mark.asyncio
async def test_change_conversation_status_envelope() -> None:
    captured: dict[str, object] = {}
    tool = ChangeConversationStatusTool(client=_client(_ok_handler(captured)))
    result = await tool.execute({"target_status": "pending", "note": "aguardando cliente"}, _ctx())
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/change_conversation_status")
    assert captured["body"]["args"] == {  # type: ignore[index]
        "target_status": "pending",
        "note": "aguardando cliente",
    }


@pytest.mark.asyncio
async def test_change_conversation_status_rejects_invalid_status() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = ChangeConversationStatusTool(client=_client(handler))
    result = await tool.execute({"target_status": "banana"}, _ctx())
    assert result.ok is False  # Literal validation → never hits the Node
    assert called is False


# ------------------------------------------------------------- validation guards
@pytest.mark.asyncio
async def test_transfer_requires_reason() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = TransferToHumanTool(client=_client(handler))
    result = await tool.execute({}, _ctx())
    assert result.ok is False
    assert called is False


# --------------------------------------------------------- register_conversion
@pytest.mark.asyncio
async def test_register_conversion_envelope_when_allowed() -> None:
    captured: dict[str, object] = {}
    tool = RegisterConversionTool(client=_client(_ok_handler(captured)))
    result = await tool.execute(
        {"type_key": "sale", "value_cents": 15000, "currency": "BRL"}, _ctx()
    )
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/register_conversion")
    assert captured["body"]["args"] == {  # type: ignore[index]
        "type_key": "sale",
        "value_cents": 15000,
        "currency": "BRL",
        "note": None,
    }


@pytest.mark.asyncio
async def test_register_conversion_blocked_by_policy_skips_callback() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    base = RegisterConversionTool(client=_client(handler))
    # Node injeta a config efetiva: política proíbe conversões pelo agente.
    tool = base.with_config({"allow_agent_conversions": False})
    result = await tool.execute({"type_key": "sale"}, _ctx())
    assert result.ok is False
    assert result.error is not None
    assert called is False  # curto-circuito ANTES do callback


@pytest.mark.asyncio
async def test_register_conversion_allowed_by_default_when_flag_absent() -> None:
    captured: dict[str, object] = {}
    tool = RegisterConversionTool(client=_client(_ok_handler(captured)))
    # Sem flag no handler_config → fail-open no cliente (Node revalida).
    result = await tool.execute({"type_key": "appointment_booked"}, _ctx())
    assert result.ok is True
    assert "url" in captured  # callback aconteceu


@pytest.mark.asyncio
async def test_register_conversion_surfaces_node_not_supported() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        # Pré-F5: Node responde "não suportado ainda".
        return httpx.Response(200, json={"ok": False, "error": "Conversões ainda não suportadas."})

    tool = RegisterConversionTool(client=_client(handler))
    result = await tool.execute({"type_key": "sale"}, _ctx())
    assert result.ok is False
    assert result.error == "Conversões ainda não suportadas."


# --------------------------------------------------------------------- playground
@pytest.mark.asyncio
async def test_playground_short_circuits_callback_for_workflow_tools() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = TransferToHumanTool(client=_client(handler))
    result = await tool.execute({"reason": "x"}, _ctx(is_playground=True))
    assert result.ok is True
    assert called is False
    assert result.payload == {"simulated": True}
