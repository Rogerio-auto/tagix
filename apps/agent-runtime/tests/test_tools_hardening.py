"""F70-S15 — tools dos agentes endurecidas no runtime.

Cobre:
  - o `config` do `ToolDescriptor` (catálogo + `agent_tools.overrides`) chega à tool
    no dispatch, num clone (a instância registrada segue com o default);
  - tools `database`: override só RESTRINGE a ACL de coluna — não amplia leitura,
    não troca a tabela, `restricted` só cresce; o SELECT gerado respeita isso;
  - `tool_dispatch` só executa tool habilitada no state (nome inventado → erro);
  - `/run` adota o `execution_id` do worker (metadata ou topo; inválido → novo);
  - `add_contact_tag` / `update_contact`: envelope certo, allowlist espelhada.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any, ClassVar

import httpx
import pytest
from pydantic import BaseModel

from app.nodes.tool_dispatch import make_tool_dispatch_node
from app.routes.run import AgentRunRequest, _execution_id
from app.tools.access_control import clamp_column_config
from app.tools.base import Tool, ToolContext, ToolResult
from app.tools.database.query_contact import QueryContactTool
from app.tools.registry import ToolRegistry
from app.tools.workflow import AddContactTagTool, UpdateContactTool
from app.types import ChatMessage, PolicySnapshot, ToolDescriptor

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeConn:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row
        self.last_query: str | None = None

    @asynccontextmanager
    async def transaction(self):
        yield

    async def execute(self, sql: str, *params: Any) -> str:
        return "OK"

    async def fetchrow(self, sql: str, *params: Any):
        self.last_query = sql
        return self._row


class FakePool:
    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self.conn = FakeConn(row)

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class _NoArgs(BaseModel):
    pass


class ConfigEchoTool(Tool):
    """Tool que devolve a config efetiva que recebeu."""

    key = "config_echo"
    name = "Eco de config"
    description = "Devolve a handler_config efetiva."
    category = "http"
    Args = _NoArgs
    default_handler_config: ClassVar[dict[str, Any]] = {"timeout_ms": 1000, "mode": "a"}

    async def _run(self, args: _NoArgs, ctx: ToolContext) -> ToolResult:
        return ToolResult(ok=True, payload=dict(self.handler_config))


def _ctx(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "workspace_id": "ws-1",
        "conversation_id": "conv-1",
        "contact_id": "contact-1",
        "agent_id": "agent-1",
        "execution_id": "exec-1",
    }
    base.update(over)
    return base


def _policy() -> PolicySnapshot:
    return PolicySnapshot(
        allowed_models=["openai/gpt-4o-mini"],
        allow_parallel_tools=False,
        max_iterations=3,
        allowed_tool_categories=[],
    )


# ---------------------------------------------------------------------------
# Config do descritor chega à tool
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registry_applies_descriptor_config_on_a_clone() -> None:
    registry = ToolRegistry()
    tool = ConfigEchoTool()
    registry.register(tool)

    out = await registry.dispatch("config_echo", {}, _ctx(tool_config={"mode": "b", "extra": True}))

    assert out["ok"] is True
    assert json.loads(out["content"]) == {"timeout_ms": 1000, "mode": "b", "extra": True}
    # A instância registrada não foi mutada.
    assert tool.handler_config == {"timeout_ms": 1000, "mode": "a"}


@pytest.mark.asyncio
async def test_registry_without_config_keeps_default() -> None:
    registry = ToolRegistry()
    registry.register(ConfigEchoTool())
    out = await registry.dispatch("config_echo", {}, _ctx())
    assert json.loads(out["content"]) == {"timeout_ms": 1000, "mode": "a"}


# ---------------------------------------------------------------------------
# Tools database: override não amplia a ACL
# ---------------------------------------------------------------------------


def test_clamp_intersects_read_and_keeps_table() -> None:
    ceiling = QueryContactTool.default_handler_config
    clamped = clamp_column_config(
        ceiling,
        {
            "table": "members",
            "allowed_columns": {
                "read": ["display_name", "notes", "owner_id", "marketing_opt_in"],
                "write": ["phone"],
            },
            "restricted_columns": ["email"],
            "timeout_ms": 500,
        },
    )
    assert clamped["table"] == "contacts"
    assert clamped["allowed_columns"] == {"read": ["display_name"], "write": []}
    assert set(clamped["restricted_columns"]) == {"notes", "email"}
    assert clamped["timeout_ms"] == 500


def test_clamp_absent_mode_keeps_ceiling() -> None:
    ceiling = QueryContactTool.default_handler_config
    clamped = clamp_column_config(ceiling, {"restricted_columns": ["phone"]})
    assert clamped["allowed_columns"]["read"] == ceiling["allowed_columns"]["read"]
    tool = QueryContactTool(FakePool()).with_config(clamped)
    assert "phone" not in tool.policy().allowed("read")


def test_database_tool_with_config_cannot_widen() -> None:
    tool = QueryContactTool(FakePool()).with_config(
        {"allowed_columns": {"read": ["display_name", "notes", "document", "opt_in_at"]}}
    )
    assert tool.policy().allowed("read") == frozenset({"display_name"})
    assert tool.policy().table == "contacts"


def test_database_tool_with_config_can_narrow() -> None:
    tool = QueryContactTool(FakePool()).with_config(
        {"allowed_columns": {"read": ["display_name", "language"]}}
    )
    assert tool.policy().allowed("read") == frozenset({"display_name", "language"})


@pytest.mark.asyncio
async def test_query_contact_select_respects_clamped_override() -> None:
    pool = FakePool({"display_name": "Maria"})
    registry = ToolRegistry()
    registry.register(QueryContactTool(pool))

    out = await registry.dispatch(
        "query_contact",
        {"fields": ["display_name", "phone", "notes", "owner_id"]},
        _ctx(tool_config={"allowed_columns": {"read": ["display_name", "notes", "owner_id"]}}),
    )

    assert out["ok"] is True
    sql = pool.conn.last_query or ""
    assert sql.startswith("SELECT display_name FROM contacts")
    for col in ("phone", "notes", "owner_id"):
        assert col not in sql


# ---------------------------------------------------------------------------
# tool_dispatch: só tools habilitadas; config vai no ctx
# ---------------------------------------------------------------------------


class RecordingRegistry:
    def __init__(self) -> None:
        self.dispatched: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    def specs_for(self, allowed_keys: set[str] | None) -> list[dict[str, Any]]:
        return []

    async def dispatch(self, key: str, args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
        self.dispatched.append((key, args, ctx))
        return {"ok": True, "content": "ok", "error": None}


def _dispatch_state(calls: list[str], tools: list[ToolDescriptor]) -> dict[str, Any]:
    return {
        "workspace_id": "ws-1",
        "agent_id": "agent-1",
        "conversation_id": "conv-1",
        "contact_id": "contact-1",
        "execution_id": "exec-1",
        "thread_id": "t",
        "policy": _policy(),
        "tools": tools,
        "iteration": 0,
        "tool_calls_executed": [],
        "messages": [
            ChatMessage(
                role="assistant",
                content="",
                tool_calls=[
                    {
                        "id": f"call_{i}",
                        "type": "function",
                        "function": {"name": key, "arguments": "{}"},
                    }
                    for i, key in enumerate(calls)
                ],
            )
        ],
    }


@pytest.mark.asyncio
async def test_dispatch_refuses_tool_not_enabled_in_state() -> None:
    registry = RecordingRegistry()
    node = make_tool_dispatch_node(tool_registry=registry)
    events: list[dict[str, Any]] = []

    patch = await node(
        _dispatch_state(
            ["query_contact", "update_contact"],
            [ToolDescriptor(key="query_contact", category="database")],
        ),
        events.append,
    )

    assert [d[0] for d in registry.dispatched] == ["query_contact"]
    refused = next(m for m in patch["messages"] if m.name == "update_contact")
    assert "não disponível" in refused.content
    executed = {e["tool_key"]: e["ok"] for e in patch["tool_calls_executed"]}
    assert executed == {"query_contact": True, "update_contact": False}


@pytest.mark.asyncio
async def test_dispatch_passes_descriptor_config_in_ctx() -> None:
    registry = RecordingRegistry()
    node = make_tool_dispatch_node(tool_registry=registry)
    cfg = {"allowed_columns": {"read": ["display_name"]}}

    await node(
        _dispatch_state(
            ["query_contact"],
            [ToolDescriptor(key="query_contact", category="database", config=cfg)],
        ),
        lambda _e: None,
    )

    _key, _args, ctx = registry.dispatched[0]
    assert ctx["tool_config"] == cfg
    assert ctx["execution_id"] == "exec-1"


# ---------------------------------------------------------------------------
# /run adota o execution_id do worker
# ---------------------------------------------------------------------------


def _run_req(**over: Any) -> AgentRunRequest:
    body: dict[str, Any] = {
        "workspace_id": "ws",
        "agent_id": "ag",
        "user_input": "oi",
        "policy_snapshot": _policy().model_dump(),
    }
    body.update(over)
    return AgentRunRequest.model_validate(body)


def test_execution_id_from_metadata() -> None:
    exec_id = str(uuid.uuid4())
    assert _execution_id(_run_req(metadata={"execution_id": exec_id})) == exec_id


def test_execution_id_top_level_wins() -> None:
    top = str(uuid.uuid4())
    meta = str(uuid.uuid4())
    req = _run_req(execution_id=top, metadata={"execution_id": meta})
    assert _execution_id(req) == top


def test_execution_id_invalid_or_absent_generates_new() -> None:
    generated = _execution_id(_run_req(metadata={"execution_id": "'; drop table x"}))
    assert str(uuid.UUID(generated)) == generated
    assert _execution_id(_run_req()) != _execution_id(_run_req())


# ---------------------------------------------------------------------------
# Tools de contato (callback Node)
# ---------------------------------------------------------------------------


def _tool_ctx() -> ToolContext:
    return ToolContext(
        workspace_id="ws-1",
        conversation_id="conv-1",
        contact_id="contact-1",
        agent_id="agent-1",
        execution_id="exec-1",
    )


def _capture(captured: dict[str, Any]) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "content": "feito"})

    return handler


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_add_contact_tag_envelope() -> None:
    captured: dict[str, Any] = {}
    tool = AddContactTagTool(client=_client(_capture(captured)))
    result = await tool.execute({"tag": "atendimento-humano"}, _tool_ctx())
    assert result.ok is True
    assert captured["url"].endswith("/internal/tools/add_contact_tag")
    assert captured["body"]["args"] == {"tag": "atendimento-humano"}
    assert "contact_id" not in captured["body"]["args"]


@pytest.mark.asyncio
async def test_add_contact_tag_rejects_extra_args_without_callback() -> None:
    captured: dict[str, Any] = {}
    tool = AddContactTagTool(client=_client(_capture(captured)))
    result = await tool.execute({"tag": "x", "contact_id": "outro"}, _tool_ctx())
    assert result.ok is False
    assert captured == {}


@pytest.mark.asyncio
async def test_update_contact_sends_only_informed_fields() -> None:
    captured: dict[str, Any] = {}
    tool = UpdateContactTool(client=_client(_capture(captured)))
    result = await tool.execute(
        {"display_name": "Maria", "custom_fields": {"plano": "anual", "filhos": 2}},
        _tool_ctx(),
    )
    assert result.ok is True
    assert captured["url"].endswith("/internal/tools/update_contact")
    assert captured["body"]["args"] == {
        "display_name": "Maria",
        "custom_fields": {"plano": "anual", "filhos": 2},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "args",
    [
        {"phone": "+5511999999999"},
        {"email": "novo@x.test"},
        {"marketing_opt_in": True},
        {"owner_id": "m-1"},
        {"display_name": "Ok", "workspace_id": "ws-2"},
        {"custom_fields": {"Chave Invalida": "x"}},
    ],
)
async def test_update_contact_rejects_outside_allowlist_without_callback(
    args: dict[str, Any],
) -> None:
    captured: dict[str, Any] = {}
    tool = UpdateContactTool(client=_client(_capture(captured)))
    result = await tool.execute(args, _tool_ctx())
    assert result.ok is False
    assert captured == {}


def test_update_contact_schema_forbids_extra_properties() -> None:
    params = UpdateContactTool(client=httpx.AsyncClient()).openai_schema()["function"]["parameters"]
    assert params.get("additionalProperties") is False
    assert set(params["properties"]) == {
        "display_name",
        "language",
        "timezone",
        "custom_fields",
    }


# ---------------------------------------------------------------------------
# M1: PII para o provedor de LLM — telefone/e-mail e custom_fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_query_contact_default_does_not_read_phone_or_email() -> None:
    pool = FakePool({"display_name": "Ana"})
    registry = ToolRegistry()
    registry.register(QueryContactTool(pool))

    await registry.dispatch(
        "query_contact",
        {"fields": ["display_name", "phone", "email"]},
        _ctx(tool_config=dict(QueryContactTool.default_handler_config)),
    )

    sql = pool.conn.last_query or ""
    assert sql.startswith("SELECT display_name FROM contacts")
    assert "phone" not in sql and "email" not in sql


def test_query_contact_override_can_enable_phone_within_ceiling_only() -> None:
    tool = QueryContactTool(FakePool()).with_config(
        {"allowed_columns": {"read": ["display_name", "phone", "notes", "owner_id"]}}
    )
    assert tool.policy().allowed("read") == frozenset({"display_name", "phone"})


@pytest.mark.asyncio
async def test_query_contact_custom_fields_only_allowed_keys() -> None:
    row = {
        "custom_fields": {
            "interesse": "plano anual " + "x" * 400,
            "cpf": "123.456.789-00",
            "endereco": {"rua": "A"},
        }
    }
    registry = ToolRegistry()
    registry.register(QueryContactTool(FakePool(dict(row))))

    closed = await registry.dispatch("query_contact", {"fields": ["custom_fields"]}, _ctx())
    assert json.loads(closed["content"]) == {"custom_fields": {}}

    opened = await registry.dispatch(
        "query_contact",
        {"fields": ["custom_fields"]},
        _ctx(tool_config={"custom_fields_keys": ["interesse", "endereco"]}),
    )
    fields = json.loads(opened["content"])["custom_fields"]
    assert set(fields) == {"interesse"}  # `cpf` não liberado; objeto aninhado não sai
    assert len(fields["interesse"]) == 200


def test_load_context_hides_custom_fields_unless_query_contact_allows() -> None:
    from app.nodes.load_context import _prompt_safe_contact

    contact = {
        "id": "c1",
        "display_name": "Maria",
        "custom_fields": {"cpf": "123", "interesse": "anual"},
    }
    hidden = _prompt_safe_contact(contact, [])
    assert hidden is not None and hidden["custom_fields"] == {}
    no_keys = [ToolDescriptor(key="query_contact", category="database", config={})]
    closed = _prompt_safe_contact(contact, no_keys)
    assert closed is not None and closed["custom_fields"] == {}
    with_keys = [
        ToolDescriptor(
            key="query_contact",
            category="database",
            config={"custom_fields_keys": ["interesse"]},
        )
    ]
    safe = _prompt_safe_contact(contact, with_keys)
    assert safe is not None
    assert safe["custom_fields"] == {"interesse": "anual"}
    assert safe["display_name"] == "Maria"
    assert _prompt_safe_contact(None, with_keys) is None


# ---------------------------------------------------------------------------
# F70-S23: `null` = não informado (L-g) e teto do nome (L-f)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_contact_null_fields_are_not_sent() -> None:
    captured: dict[str, Any] = {}
    tool = UpdateContactTool(client=_client(_capture(captured)))
    result = await tool.execute(
        {
            "display_name": None,
            "timezone": None,
            "language": "pt-BR",
            "custom_fields": {"interesse": None},
        },
        _tool_ctx(),
    )
    assert result.ok is True
    # `null` no topo some; dentro de `custom_fields` é valor (limpa a chave).
    assert captured["body"]["args"] == {"language": "pt-BR", "custom_fields": {"interesse": None}}


@pytest.mark.asyncio
async def test_update_contact_display_name_over_80_is_rejected_without_callback() -> None:
    captured: dict[str, Any] = {}
    tool = UpdateContactTool(client=_client(_capture(captured)))
    result = await tool.execute({"display_name": "A" * 81}, _tool_ctx())
    assert result.ok is False
    assert captured == {}
