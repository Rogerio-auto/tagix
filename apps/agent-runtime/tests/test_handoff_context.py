"""Testes da retomada consciente de contexto (F30-S05 / LIVECHAT_OPS §2).

Cobre os dois nós tocados:

- `load_context`: rotula a autoria das mensagens (`human|ai|contact`) a partir de
  `messages.sender_type` e detecta `human_takeover` (mensagem de `member` OU
  `conversations.ai_paused_reason='human_takeover'`).
- `build_prompt`: injeta a diretriz de handoff + o histórico rotulado SOMENTE quando
  houve atendimento humano. Sem humano → zero injeção (sem regressão no fluxo normal).

Sem rede e sem DB real: o pool asyncpg é um fake injetado na fábrica do node.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from app.nodes.build_prompt import build_prompt_node
from app.nodes.load_context import make_load_context_node
from app.types import AgentState, ChatMessage, PolicySnapshot, UsageAccumulator

# ---------------------------------------------------------------------------
# Fakes de DB
# ---------------------------------------------------------------------------


class _FakeConn:
    """Conn asyncpg fake: serve agent/conversation por `fetchrow` e mensagens por `fetch`."""

    def __init__(
        self,
        *,
        agent_row: dict[str, Any],
        conversation_row: dict[str, Any] | None,
        message_rows: list[dict[str, Any]],
    ) -> None:
        self._agent_row = agent_row
        self._conversation_row = conversation_row
        self._message_rows = message_rows
        self.executed: list[str] = []

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield

    async def execute(self, query: str, *args: Any) -> str:
        self.executed.append(query.strip().split()[0].upper())
        return "OK"

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if "FROM agents" in query:
            return self._agent_row
        if "FROM contacts" in query:
            return None
        if "FROM conversations" in query:
            return self._conversation_row
        return None

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        if "FROM messages" in query:
            # O node ordena DESC e re-inverte; devolvemos como o DB devolveria (DESC).
            return list(reversed(self._message_rows))
        return []


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_FakeConn]:
        yield self._conn


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _policy() -> PolicySnapshot:
    return PolicySnapshot(
        allowed_models=["openai/gpt-4o-mini"],
        allow_streaming=False,
        max_iterations=3,
        allowed_tool_categories=["database"],
    )


def _agent_row() -> dict[str, Any]:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Vendedor",
        "model": "openai/gpt-4o-mini",
        "model_params": {},
        "system_prompt": "Você é um vendedor.",
        "model_supports_vision": False,
    }


def _conversation_row(*, ai_paused_reason: str | None = None) -> dict[str, Any]:
    return {
        "id": "44444444-4444-4444-4444-444444444444",
        "status": "open",
        "channel_provider": "whatsapp",
        "kind": "direct",
        "ai_paused_reason": ai_paused_reason,
    }


def _msg(sender_type: str, content: str) -> dict[str, Any]:
    return {"sender_type": sender_type, "content": content}


def _state(*, conversation_id: str | None) -> AgentState:
    return {
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "agent_id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": conversation_id,
        "contact_id": None,
        "thread_id": "t",
        "execution_id": "33333333-3333-3333-3333-333333333333",
        "is_playground": False,
        "policy": _policy(),
        "user_input": "Oi",
        "history": [],
        "messages": [],
        "tools": [],
        "iteration": 0,
        "usage": UsageAccumulator(),
        "tool_calls_executed": [],
        "errors": [],
    }


async def _run_load_context(
    *,
    conversation_row: dict[str, Any] | None,
    message_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    conn = _FakeConn(
        agent_row=_agent_row(),
        conversation_row=conversation_row,
        message_rows=message_rows,
    )
    node = make_load_context_node(_FakePool(conn))  # type: ignore[arg-type]
    conv_id = conversation_row["id"] if conversation_row else None
    return await node(_state(conversation_id=conv_id))


# ---------------------------------------------------------------------------
# load_context — rotulagem de autoria + detecção de takeover
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_context_labels_authorship_per_message() -> None:
    patch = await _run_load_context(
        conversation_row=_conversation_row(),
        message_rows=[
            _msg("contact", "Tenho uma dúvida"),
            _msg("agent", "Posso ajudar!"),
            _msg("member", "Aqui é o João, vou assumir"),
        ],
    )

    conversation = patch["conversation"]
    authored = conversation["authored_history"]
    assert [m["author_role"] for m in authored] == ["contact", "ai", "human"]
    assert authored[0]["content"] == "Tenho uma dúvida"


@pytest.mark.asyncio
async def test_load_context_detects_human_takeover_via_member_message() -> None:
    patch = await _run_load_context(
        conversation_row=_conversation_row(),
        message_rows=[
            _msg("contact", "Olá"),
            _msg("member", "Oi, sou o atendente"),
        ],
    )
    assert patch["conversation"]["human_takeover"] is True


@pytest.mark.asyncio
async def test_load_context_detects_human_takeover_via_ai_paused_reason() -> None:
    # Sem mensagem de member, mas a conversa foi pausada por takeover humano.
    patch = await _run_load_context(
        conversation_row=_conversation_row(ai_paused_reason="human_takeover"),
        message_rows=[_msg("contact", "Olá"), _msg("agent", "Oi!")],
    )
    assert patch["conversation"]["human_takeover"] is True


@pytest.mark.asyncio
async def test_load_context_no_human_takeover_for_ai_only_thread() -> None:
    patch = await _run_load_context(
        conversation_row=_conversation_row(),
        message_rows=[
            _msg("contact", "Olá"),
            _msg("agent", "Oi, tudo bem?"),
            _msg("contact", "Quero saber preços"),
        ],
    )
    conversation = patch["conversation"]
    assert conversation["human_takeover"] is False
    assert all(m["author_role"] in ("contact", "ai") for m in conversation["authored_history"])


@pytest.mark.asyncio
async def test_load_context_without_conversation_is_unaffected() -> None:
    patch = await _run_load_context(conversation_row=None, message_rows=[])
    assert patch["conversation"] is None


# ---------------------------------------------------------------------------
# build_prompt — diretriz injetada só quando houve humano
# ---------------------------------------------------------------------------


async def _system_prompt_for(conversation: dict[str, Any] | None) -> str:
    state = _state(conversation_id="x" if conversation else None)
    state["conversation"] = conversation
    state["history"] = [
        ChatMessage(role="user", content="anterior do cliente"),
        ChatMessage(role="assistant", content="resposta anterior"),
    ]
    patch = await build_prompt_node(state)
    messages = patch["messages"]
    assert messages[0].role == "system"
    return messages[0].content or ""


@pytest.mark.asyncio
async def test_build_prompt_injects_handoff_directive_when_human_took_over() -> None:
    conversation = _conversation_row()
    conversation["human_takeover"] = True
    conversation["authored_history"] = [
        {"author_role": "contact", "content": "Tenho uma dúvida"},
        {"author_role": "ai", "content": "Posso ajudar!"},
        {"author_role": "human", "content": "Aqui é o João, vou assumir"},
    ]

    system = await _system_prompt_for(conversation)

    assert "RETOMADA DE CONVERSA" in system
    assert "atendente humano assumiu" in system
    # Histórico rotulado por autoria presente no prompt.
    assert "[Cliente] Tenho uma dúvida" in system
    assert "[Atendente humano] Aqui é o João, vou assumir" in system
    assert "[IA (você, em turnos anteriores)] Posso ajudar!" in system


@pytest.mark.asyncio
async def test_build_prompt_no_directive_when_ai_only() -> None:
    conversation = _conversation_row()
    conversation["human_takeover"] = False
    conversation["authored_history"] = [
        {"author_role": "contact", "content": "Olá"},
        {"author_role": "ai", "content": "Oi!"},
    ]

    system = await _system_prompt_for(conversation)

    assert "RETOMADA DE CONVERSA" not in system
    assert "[Atendente humano]" not in system


@pytest.mark.asyncio
async def test_build_prompt_normal_flow_has_no_regression() -> None:
    # Sem conversation (fluxo mínimo): nenhuma menção a handoff e estrutura intacta.
    state = _state(conversation_id=None)
    state["history"] = [ChatMessage(role="user", content="oi")]
    patch = await build_prompt_node(state)
    messages = patch["messages"]

    assert messages[0].role == "system"
    assert "RETOMADA DE CONVERSA" not in (messages[0].content or "")
    # [system, ...history, user]: a última mensagem é o turno atual do usuário.
    assert messages[-1].role == "user"
    assert messages[-1].content == "Oi"
