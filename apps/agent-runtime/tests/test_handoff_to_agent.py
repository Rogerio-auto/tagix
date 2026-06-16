"""Testes do handoff autônomo IA→IA (F34-S06 / AGENT_DEPARTMENT_ROUTING_PLAN D3).

Cobre as três peças do runtime:

- **tool `transfer_to_agent`** — schema/args casam o contrato Zod do Node (S05);
  envelope serializado em camelCase (`targetAgentId`); validação de args antes do
  callback; playground curto-circuita o efeito.
- **`load_context`** — expõe `transfer_to_agent` ao LLM SÓ quando `allow_handoff=true`
  E há ≥1 par; rotula turno de OUTRO agente de IA (`ai_other`) distinto do atual (`ai`).
- **`build_prompt`** — injeta a diretriz + a lista de pares (nome/dept/quando/id) só
  quando habilitado; rotula `[Outro agente de IA]` no histórico; zero regressão quando OFF.

Sem rede e sem DB real: o pool asyncpg e o http client são fakes injetados.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest

from app.nodes.build_prompt import build_prompt_node
from app.nodes.load_context import make_load_context_node
from app.tools.base import ToolContext
from app.tools.registry import ToolRegistry
from app.tools.workflow import (
    TransferToAgentTool,
    build_workflow_tools,
    register_workflow_tools,
)
from app.types import (
    AgentState,
    ChatMessage,
    PolicySnapshot,
    ToolDescriptor,
    UsageAccumulator,
)

_CURRENT_AGENT = "11111111-1111-1111-1111-111111111111"
_OTHER_AGENT = "99999999-9999-9999-9999-999999999999"


# ---------------------------------------------------------------------------
# tool transfer_to_agent — contrato com o Node (S05)
# ---------------------------------------------------------------------------


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
        return httpx.Response(
            200,
            json={"ok": True, "content": "Conversa transferida. Pare de responder."},
        )

    return handler


def test_transfer_to_agent_is_a_workflow_tool() -> None:
    tools = {t.key: t for t in build_workflow_tools(httpx.AsyncClient())}
    tool = tools["transfer_to_agent"]
    assert tool.category == "workflow"
    schema = tool.openai_schema()
    assert schema["function"]["name"] == "transfer_to_agent"
    props = schema["function"]["parameters"]["properties"]
    # Contrato Zod do Node (S05): camelCase, targetAgentId obrigatório.
    assert "targetAgentId" in props
    assert "reason" in props
    assert schema["function"]["parameters"]["required"] == ["targetAgentId"]


def test_register_workflow_tools_includes_transfer_to_agent() -> None:
    registry = ToolRegistry()
    register_workflow_tools(registry, httpx.AsyncClient())
    assert "transfer_to_agent" in registry.keys()


@pytest.mark.asyncio
async def test_transfer_to_agent_posts_camelcase_envelope() -> None:
    captured: dict[str, object] = {}
    tool = TransferToAgentTool(client=_client(_ok_handler(captured)))
    result = await tool.execute(
        {"targetAgentId": _OTHER_AGENT, "reason": "assunto financeiro"}, _ctx()
    )
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/transfer_to_agent")
    assert captured["auth"] == "Bearer test-internal-token"
    # O wire deve casar EXATAMENTE o Zod do Node: targetAgentId (camelCase), não snake.
    assert captured["body"] == {  # type: ignore[comparison-overlap]
        "workspace_id": "ws-1",
        "conversation_id": "conv-1",
        "agent_id": "agent-1",
        "execution_id": "exec-1",
        "args": {"targetAgentId": _OTHER_AGENT, "reason": "assunto financeiro"},
    }


@pytest.mark.asyncio
async def test_transfer_to_agent_reason_is_optional() -> None:
    captured: dict[str, object] = {}
    tool = TransferToAgentTool(client=_client(_ok_handler(captured)))
    result = await tool.execute({"targetAgentId": _OTHER_AGENT}, _ctx())
    assert result.ok is True
    assert captured["body"]["args"] == {  # type: ignore[index]
        "targetAgentId": _OTHER_AGENT,
        "reason": None,
    }


@pytest.mark.asyncio
async def test_transfer_to_agent_requires_target() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = TransferToAgentTool(client=_client(handler))
    result = await tool.execute({"reason": "sem alvo"}, _ctx())
    assert result.ok is False  # targetAgentId obrigatório → nunca bate no Node
    assert called is False


@pytest.mark.asyncio
async def test_transfer_to_agent_playground_short_circuits() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = TransferToAgentTool(client=_client(handler))
    result = await tool.execute({"targetAgentId": _OTHER_AGENT}, _ctx(is_playground=True))
    assert result.ok is True
    assert called is False
    assert result.payload == {"simulated": True}


# ---------------------------------------------------------------------------
# Fakes de DB para load_context (com pares + autoria por agente)
# ---------------------------------------------------------------------------


class _FakeConn:
    def __init__(
        self,
        *,
        agent_row: dict[str, Any],
        conversation_row: dict[str, Any] | None,
        message_rows: list[dict[str, Any]],
        peer_rows: list[dict[str, Any]],
    ) -> None:
        self._agent_row = agent_row
        self._conversation_row = conversation_row
        self._message_rows = message_rows
        self._peer_rows = peer_rows

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield

    async def execute(self, query: str, *args: Any) -> str:
        return "OK"

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if "FROM agents" in query and "agent_departments" not in query:
            return self._agent_row
        if "FROM contacts" in query:
            return None
        if "FROM conversations" in query:
            return self._conversation_row
        return None

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        if "FROM messages" in query:
            return list(reversed(self._message_rows))  # DB devolve DESC
        if "FROM agent_departments" in query:
            return list(self._peer_rows)
        return []


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_FakeConn]:
        yield self._conn


def _policy() -> PolicySnapshot:
    return PolicySnapshot(
        allowed_models=["openai/gpt-4o-mini"],
        allow_streaming=False,
        max_iterations=3,
        allowed_tool_categories=["workflow"],
    )


def _agent_row(*, allow_handoff: bool) -> dict[str, Any]:
    return {
        "id": _CURRENT_AGENT,
        "name": "Vendas",
        "model": "openai/gpt-4o-mini",
        "model_params": {},
        "system_prompt": "Você é o agente de Vendas.",
        "model_supports_vision": False,
        "allow_handoff": allow_handoff,
    }


def _conversation_row() -> dict[str, Any]:
    return {
        "id": "44444444-4444-4444-4444-444444444444",
        "status": "open",
        "channel_provider": "whatsapp",
        "kind": "direct",
        "ai_paused_reason": None,
    }


def _peer_row() -> dict[str, Any]:
    return {
        "id": _OTHER_AGENT,
        "name": "Financeiro",
        "department": "Financeiro",
        "description": "Cobranças, boletos e segunda via.",
    }


def _msg(sender_type: str, content: str, *, sender_agent_id: str | None = None) -> dict[str, Any]:
    return {
        "sender_type": sender_type,
        "sender_agent_id": sender_agent_id,
        "content": content,
    }


def _state() -> AgentState:
    return {
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "agent_id": _CURRENT_AGENT,
        "conversation_id": "44444444-4444-4444-4444-444444444444",
        "contact_id": None,
        "thread_id": "t",
        "execution_id": "33333333-3333-3333-3333-333333333333",
        "is_playground": False,
        "policy": _policy(),
        "user_input": "Oi",
        "history": [],
        "messages": [],
        "tools": [ToolDescriptor(key="transfer_to_agent", category="workflow")],
        "iteration": 0,
        "usage": UsageAccumulator(),
        "tool_calls_executed": [],
        "errors": [],
    }


async def _run_load_context(
    *,
    allow_handoff: bool,
    peer_rows: list[dict[str, Any]],
    message_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    conn = _FakeConn(
        agent_row=_agent_row(allow_handoff=allow_handoff),
        conversation_row=_conversation_row(),
        message_rows=message_rows or [_msg("contact", "Olá")],
        peer_rows=peer_rows,
    )
    node = make_load_context_node(_FakePool(conn))  # type: ignore[arg-type]
    return await node(_state())


def _tool_keys(patch: dict[str, Any]) -> set[str]:
    return {t.key for t in patch["tools"]}


# ---------------------------------------------------------------------------
# load_context — gate da tool + peers + autoria IA→IA
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tool_exposed_when_allow_handoff_and_peer_present() -> None:
    patch = await _run_load_context(allow_handoff=True, peer_rows=[_peer_row()])
    assert "transfer_to_agent" in _tool_keys(patch)
    assert patch["agent"]["allow_handoff"] is True
    assert len(patch["agent"]["handoff_peers"]) == 1


@pytest.mark.asyncio
async def test_tool_hidden_when_allow_handoff_but_no_peers() -> None:
    patch = await _run_load_context(allow_handoff=True, peer_rows=[])
    assert "transfer_to_agent" not in _tool_keys(patch)
    assert patch["agent"]["allow_handoff"] is False
    assert patch["agent"]["handoff_peers"] == []


@pytest.mark.asyncio
async def test_tool_hidden_when_handoff_disabled_even_with_peers() -> None:
    # allow_handoff=False: nem consulta pares; tool filtrada.
    patch = await _run_load_context(allow_handoff=False, peer_rows=[_peer_row()])
    assert "transfer_to_agent" not in _tool_keys(patch)
    assert patch["agent"]["allow_handoff"] is False


@pytest.mark.asyncio
async def test_history_labels_other_ai_agent_distinctly() -> None:
    patch = await _run_load_context(
        allow_handoff=True,
        peer_rows=[_peer_row()],
        message_rows=[
            _msg("contact", "Tenho um boleto"),
            _msg("agent", "Sou de Vendas", sender_agent_id=_CURRENT_AGENT),
            _msg("agent", "Aqui é o Financeiro", sender_agent_id=_OTHER_AGENT),
        ],
    )
    roles = [m["author_role"] for m in patch["conversation"]["authored_history"]]
    assert roles == ["contact", "ai", "ai_other"]


# ---------------------------------------------------------------------------
# build_prompt — diretriz + pares + rótulo no histórico
# ---------------------------------------------------------------------------


async def _system_prompt_with_agent(agent: dict[str, Any]) -> str:
    state = _state()
    state["agent"] = agent
    state["conversation"] = None
    state["history"] = [ChatMessage(role="user", content="oi")]
    patch = await build_prompt_node(state)
    return patch["messages"][0].content or ""


@pytest.mark.asyncio
async def test_prompt_injects_directive_and_peers_when_enabled() -> None:
    agent = _agent_row(allow_handoff=True)
    agent["allow_handoff"] = True
    agent["handoff_peers"] = [_peer_row()]

    system = await _system_prompt_with_agent(agent)

    assert "TRANSFERÊNCIA PARA OUTRO AGENTE" in system
    assert "transfer_to_agent" in system
    # nome + departamento + id + "quando usar".
    assert "Financeiro (Financeiro)" in system
    assert f"[id: {_OTHER_AGENT}]" in system
    assert "Cobranças, boletos e segunda via." in system


@pytest.mark.asyncio
async def test_prompt_has_no_handoff_block_when_disabled() -> None:
    agent = _agent_row(allow_handoff=False)
    agent["allow_handoff"] = False
    agent["handoff_peers"] = []

    system = await _system_prompt_with_agent(agent)

    assert "TRANSFERÊNCIA PARA OUTRO AGENTE" not in system


@pytest.mark.asyncio
async def test_prompt_labels_other_ai_agent_in_history() -> None:
    # Conversa que veio de outro agente de IA: o histórico deve rotular [Outro agente de IA].
    state = _state()
    state["agent"] = {"system_prompt": "Você é o Financeiro."}
    state["conversation"] = {
        "id": "x",
        "status": "open",
        "channel_provider": "whatsapp",
        "kind": "direct",
        "human_takeover": True,  # reusa o canal de retomada para renderizar o transcript
        "authored_history": [
            {"author_role": "contact", "content": "Tenho um boleto"},
            {"author_role": "ai_other", "content": "Sou de Vendas, vou te passar"},
            {"author_role": "ai", "content": "Aqui é o Financeiro"},
        ],
    }
    state["history"] = [ChatMessage(role="user", content="oi")]
    patch = await build_prompt_node(state)
    system = patch["messages"][0].content or ""

    assert "[Outro agente de IA] Sou de Vendas, vou te passar" in system
    assert "[IA (você, em turnos anteriores)] Aqui é o Financeiro" in system
