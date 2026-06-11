"""Tool `get_available_slots` — horários livres numa data (F7-S04).

Tool de calendar (callback Node): o Node chama `compute_available_slots` (F7-S01)
sob RLS — respeitando regras de disponibilidade, exceções, conflitos de eventos,
buffer e antecedência mínima. O Python só declara o contrato. Playground
curto-circuita no `CallbackTool`.

Spec: docs/features/CALENDAR.md §3, §4.2.

## Contrato Node (`POST /internal/tools/get_available_slots`)

  - envelope `args`: `{ date: 'YYYY-MM-DD', member_id?: str, calendar_id?: str,
    interval_minutes?: int, min_notice_minutes?: int, buffer_minutes?: int,
    max_slots?: int }`. O Node resolve o member a partir de member_id, do dono do
    calendar_id, ou do calendar default do workspace.
  - leitura: `SELECT * FROM compute_available_slots(...)`.
  - resposta: `{ ok, content?, payload?: { slots: [{ start_at, end_at, duration_minutes }] } }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.callback import CallbackTool


class GetAvailableSlotsArgs(BaseModel):
    """Argumentos para buscar horários disponíveis."""

    date: str = Field(
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Data desejada no formato YYYY-MM-DD (ex.: '2026-06-15').",
    )
    member_id: str | None = Field(
        default=None,
        description=(
            "ID do member cuja agenda consultar. Opcional: se omitido, o servidor "
            "usa o dono do calendar_id ou o calendar padrão do workspace."
        ),
    )
    calendar_id: str | None = Field(
        default=None,
        description="ID do calendário a consultar. Opcional (resolve member via dono).",
    )
    interval_minutes: int = Field(
        default=60,
        ge=15,
        le=240,
        description="Duração de cada slot em minutos (default 60).",
    )
    min_notice_minutes: int = Field(
        default=30,
        ge=0,
        description="Antecedência mínima em minutos a partir de agora (default 30).",
    )
    buffer_minutes: int = Field(
        default=15,
        ge=0,
        le=240,
        description="Folga em minutos antes/depois de eventos existentes (default 15).",
    )
    max_slots: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Número máximo de horários a retornar (default 10).",
    )


class GetAvailableSlotsTool(CallbackTool):
    key = "get_available_slots"
    name = "Buscar horários disponíveis"
    description = (
        "Retorna os horários livres numa data, respeitando regras de "
        "disponibilidade, bloqueios e conflitos de agenda. SEMPRE chame esta tool "
        "antes de agendar, para oferecer horários reais ao cliente."
    )
    category = "calendar"
    Args = GetAvailableSlotsArgs
