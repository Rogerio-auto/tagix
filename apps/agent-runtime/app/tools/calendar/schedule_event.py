"""Tool `schedule_event` — cria um evento/reunião na agenda (F7-S04).

Tool de calendar (callback Node): o Node reusa `createEvent` (F7-S03) — ponto
ÚNICO de criação de evento, que insere o evento + participantes (organizer = dono
do calendar; attendee = contact) e dispara o seam de notificação. O Python NÃO
duplica nenhuma regra; só declara o contrato. Em playground o `CallbackTool`
curto-circuita: nenhum evento é criado (simulação).

Spec: docs/features/CALENDAR.md §4.3.

## Contrato Node (`POST /internal/tools/schedule_event`)

  - envelope `args`: `{ title: str, start_at: ISO8601, end_at: ISO8601,
    calendar_id?: str, type?: str, description?: str, location?: str,
    meeting_url?: str, contact_id?: str }`. O Node resolve calendar_id
    (arg > calendar default do workspace) e o contact (arg > contato da conversa).
  - mutação: `createEvent` (actor.type='agent') — evento + participants + seam.
  - resposta: `{ ok, content?, payload?: { event_id, title, start_at, end_at } }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class ScheduleEventArgs(BaseModel):
    """Argumentos para agendar um evento."""

    title: str = Field(
        min_length=2,
        max_length=300,
        description="Título do evento (ex.: 'Reunião com João — apresentação').",
    )
    start_at: str = Field(
        description=(
            "Início do evento em ISO-8601 COM fuso (ex.: '2026-06-15T10:00:00-03:00'). "
            "Use um dos horários retornados por get_available_slots."
        ),
    )
    end_at: str = Field(
        description="Fim do evento em ISO-8601 com fuso (ex.: '2026-06-15T11:00:00-03:00').",
    )
    calendar_id: str | None = Field(
        default=None,
        description="ID do calendário onde criar. Opcional: usa o padrão do workspace.",
    )
    type: str | None = Field(
        default=None,
        description=(
            "Tipo do evento: 'meeting', 'demo', 'follow_up', 'task', 'reminder' ou "
            "'other'. Default 'meeting'."
        ),
    )
    description: str | None = Field(
        default=None,
        max_length=5000,
        description="Descrição/pauta opcional do evento.",
    )
    location: str | None = Field(
        default=None,
        max_length=500,
        description="Local presencial opcional.",
    )
    meeting_url: str | None = Field(
        default=None,
        max_length=1000,
        description="URL da reunião online (opcional).",
    )
    contact_id: str | None = Field(
        default=None,
        description=(
            "ID do contato participante. Opcional: se omitido, o servidor usa o "
            "contato da conversa atual."
        ),
    )


class ScheduleEventTool(CallbackTool):
    key = "schedule_event"
    name = "Agendar evento"
    description = (
        "Cria um evento/reunião na agenda com início, fim e participantes. SEMPRE "
        "chame get_available_slots antes para confirmar que o horário está livre. "
        "Use horários em ISO-8601 com fuso. Em simulação (playground) nenhum evento "
        "é criado de fato."
    )
    category = "calendar"
    Args = ScheduleEventArgs
