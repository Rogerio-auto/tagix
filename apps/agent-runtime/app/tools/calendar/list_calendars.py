"""Tool `list_calendars` — lista os calendários do workspace (F7-S04).

Tool de calendar (callback Node, padrão F5): o Python declara só o contrato; o
Node (`apps/api/src/internal/tools/calendar-handlers.ts`) é a *single source of
truth*, lista sob RLS e grava `tool_logs`. Em playground o `CallbackTool`
curto-circuita (sem callback).

Spec: docs/features/CALENDAR.md §4.1.

## Contrato Node (`POST /internal/tools/list_calendars`)

  - envelope `args`: `{ owner_member_id: str | None, type: 'personal'|'team'|'workspace'|None }`
  - leitura: calendars do workspace (RLS), filtrados por owner/type se fornecidos.
  - resposta: `{ ok, content?, payload?: { calendars: [{ id, name, type, is_default }] } }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class ListCalendarsArgs(BaseModel):
    """Argumentos para listar calendários."""

    owner_member_id: str | None = Field(
        default=None,
        description=(
            "Filtra os calendários por dono (member). Opcional: se omitido, "
            "retorna todos os calendários acessíveis no workspace."
        ),
    )
    type: str | None = Field(
        default=None,
        description=(
            "Filtra por tipo de calendário: 'personal', 'team' ou 'workspace'. "
            "Opcional."
        ),
    )


class ListCalendarsTool(CallbackTool):
    key = "list_calendars"
    name = "Listar calendários"
    description = (
        "Lista os calendários disponíveis no workspace, com seus IDs, nomes e "
        "tipos. Use antes de buscar horários ou agendar, para descobrir em qual "
        "calendário marcar a reunião."
    )
    category = "calendar"
    Args = ListCalendarsArgs
