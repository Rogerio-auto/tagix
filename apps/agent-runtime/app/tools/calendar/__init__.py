"""Tools de calendar do agent-runtime (F7-S04) — todas callback Node.

Espelha o pacote `workflow`: cada tool subclassa `CallbackTool` (F2-S07), declara
`key`/`name`/`description`/`category='calendar'` + `Args`, e delega o efeito ao
Node (`apps/api/src/internal/tools/calendar-handlers.ts`) — single source of
truth, sob RLS, grava `tool_logs`. `schedule_event` reusa `createEvent` (F7-S03).

`register_calendar_tools(registry, http_client)` instancia cada tool com o client
httpx compartilhado e a registra. O lifespan do `main.py` chama isto após
`register_workflow_tools`.
"""

from __future__ import annotations

import httpx

from app.tools.base import Tool
from app.tools.calendar.get_available_slots import (
    GetAvailableSlotsArgs,
    GetAvailableSlotsTool,
)
from app.tools.calendar.list_calendars import ListCalendarsArgs, ListCalendarsTool
from app.tools.calendar.schedule_event import ScheduleEventArgs, ScheduleEventTool
from app.tools.registry import ToolRegistry

__all__ = [
    "GetAvailableSlotsArgs",
    "GetAvailableSlotsTool",
    "ListCalendarsArgs",
    "ListCalendarsTool",
    "ScheduleEventArgs",
    "ScheduleEventTool",
    "build_calendar_tools",
    "register_calendar_tools",
]

# Ordem estável (determinismo de boot/diagnóstico): descobrir → consultar → agir.
_CALENDAR_TOOL_CLASSES: tuple[type[Tool], ...] = (
    ListCalendarsTool,
    GetAvailableSlotsTool,
    ScheduleEventTool,
)


def build_calendar_tools(http_client: httpx.AsyncClient) -> list[Tool]:
    """Instancia as tools de calendar com o `http_client` compartilhado injetado.

    As tools NÃO tomam posse do client (`_owns_client=False`); o lifespan o fecha.
    """
    return [cls(client=http_client) for cls in _CALENDAR_TOOL_CLASSES]


def register_calendar_tools(
    registry: ToolRegistry,
    http_client: httpx.AsyncClient,
) -> ToolRegistry:
    """Registra todas as tools de calendar no `registry`. Encadeável."""
    for tool in build_calendar_tools(http_client):
        registry.register(tool)
    return registry
