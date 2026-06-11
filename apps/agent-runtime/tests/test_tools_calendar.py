"""Testes das tools de calendar (F7-S04).

Sem rede real: `httpx.MockTransport` injeta respostas e captura a requisição.
Cobre, para cada tool de calendar:
  - `toolKey` na URL + envelope serializado;
  - schema OpenAI exposto + categoria 'calendar';
  - validação de Args (campos obrigatórios) antes do callback;
  - `register_calendar_tools` registra as 3;
  - playground curto-circuita (schedule_event NÃO cria evento em simulação).
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from app.tools.base import ToolContext
from app.tools.calendar import (
    GetAvailableSlotsTool,
    ListCalendarsTool,
    ScheduleEventTool,
    build_calendar_tools,
    register_calendar_tools,
)
from app.tools.registry import ToolRegistry

_KEYS = {"list_calendars", "get_available_slots", "schedule_event"}


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
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "content": "feito"})

    return handler


def test_all_calendar_tools_declare_category_and_keys() -> None:
    tools = build_calendar_tools(httpx.AsyncClient())
    assert {t.key for t in tools} == _KEYS
    for t in tools:
        assert t.category == "calendar"
        assert t.name and t.description
        schema = t.openai_schema()
        assert schema["function"]["name"] == t.key
        assert "parameters" in schema["function"]


def test_register_calendar_tools_registers_all() -> None:
    registry = ToolRegistry()
    returned = register_calendar_tools(registry, httpx.AsyncClient())
    assert returned is registry
    assert _KEYS <= registry.keys()


@pytest.mark.asyncio
async def test_list_calendars_posts_envelope() -> None:
    captured: dict[str, object] = {}
    tool = ListCalendarsTool(client=_client(_ok_handler(captured)))
    result = await tool.execute({"type": "personal"}, _ctx())
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/list_calendars")
    assert captured["body"]["args"]["type"] == "personal"  # type: ignore[index]


@pytest.mark.asyncio
async def test_get_available_slots_envelope_and_defaults() -> None:
    captured: dict[str, object] = {}
    tool = GetAvailableSlotsTool(client=_client(_ok_handler(captured)))
    result = await tool.execute({"date": "2099-01-05"}, _ctx())
    assert result.ok is True
    body = captured["body"]
    assert isinstance(body, dict)
    assert str(captured["url"]).endswith("/internal/tools/get_available_slots")
    args = body["args"]
    assert args["date"] == "2099-01-05"
    assert args["interval_minutes"] == 60
    assert args["min_notice_minutes"] == 30
    assert args["buffer_minutes"] == 15
    assert args["max_slots"] == 10


@pytest.mark.asyncio
async def test_get_available_slots_rejects_bad_date() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = GetAvailableSlotsTool(client=_client(handler))
    result = await tool.execute({"date": "15/06/2099"}, _ctx())
    assert result.ok is False
    assert called is False  # validação antes do callback


@pytest.mark.asyncio
async def test_schedule_event_requires_title_and_times() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = ScheduleEventTool(client=_client(handler))
    result = await tool.execute({"title": "x"}, _ctx())  # falta start_at/end_at
    assert result.ok is False
    assert called is False


@pytest.mark.asyncio
async def test_schedule_event_envelope_when_valid() -> None:
    captured: dict[str, object] = {}
    tool = ScheduleEventTool(client=_client(_ok_handler(captured)))
    result = await tool.execute(
        {
            "title": "Reunião com João",
            "start_at": "2099-01-05T10:00:00-03:00",
            "end_at": "2099-01-05T11:00:00-03:00",
        },
        _ctx(),
    )
    assert result.ok is True
    assert str(captured["url"]).endswith("/internal/tools/schedule_event")
    assert captured["body"]["args"]["title"] == "Reunião com João"  # type: ignore[index]


@pytest.mark.asyncio
async def test_playground_short_circuits_schedule_event() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"ok": True})

    tool = ScheduleEventTool(client=_client(handler))
    result = await tool.execute(
        {
            "title": "Sim",
            "start_at": "2099-01-05T10:00:00-03:00",
            "end_at": "2099-01-05T11:00:00-03:00",
        },
        _ctx(is_playground=True),
    )
    assert result.ok is True
    assert called is False  # nenhum evento criado em simulação
    assert result.payload == {"simulated": True}
