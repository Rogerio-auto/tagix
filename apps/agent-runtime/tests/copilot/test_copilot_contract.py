"""Fixtures de contrato API ↔ runtime (consumidas pelo F73-S10 no lado Node).

`tests/copilot/fixtures/*.json`:
- `run_request.json`: um `CopilotRunRequest` válido;
- `turn_events.json`: os eventos de um turno feliz (status → tool_call_completed →
  verdict_delta… → final);
- `turn_events_iteration_exceeded.json`: turno que estoura o teto (fallback de formato);
- `turn_events_timeout.json`: turno que estoura o tempo.

As fixtures são **geradas pelo runtime real** (grafo + rota com fakes determinísticos),
não escritas à mão: este teste roda o turno de novo e exige igualdade. Mudou o
contrato? Rode com `UPDATE_COPILOT_FIXTURES=1` e revise o diff junto com o Zod.
"""

from __future__ import annotations

import itertools
import json
import os
import uuid
from typing import Any

import pytest
from copilot_fakes import (
    FIXTURES_DIR,
    HANG,
    FakeNode,
    ScriptedProvider,
    answer_script,
    json_responder,
    ok_envelope,
    request_body,
    run_turn,
    tool_call_script,
    with_policy,
)
from pydantic import TypeAdapter

import app.copilot.graph as graph_module
from app.copilot.types import CopilotRunRequest, CopilotRuntimeEvent

_EVENTS = TypeAdapter(list[CopilotRuntimeEvent])
_UPDATE = os.environ.get("UPDATE_COPILOT_FIXTURES") == "1"

ANSWER = {
    "verdict": "Três negócios de alinhadores estão parados há mais de 7 dias, somando R$ 19.900.",
    "why": ["Caio está há 12 dias sem resposta (R$ 7.200).", "Ana, 9 dias; Lia, 8 dias."],
    "data_refs": ["r-deals-1"],
    "sources": [{"label": "Pipeline", "as_of": "2026-10-16T09:30:00-03:00"}],
    "next_steps": [
        {"label": "Abrir os 3 negócios", "action": {"kind": "navigate", "value": "/pipeline"}},
        {"label": "Quem cuida deles?", "action": {"kind": "ask", "value": "Quem cuida deles?"}},
    ],
}


@pytest.fixture(autouse=True)
def _deterministic_call_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    counter = itertools.count(1)
    monkeypatch.setattr(
        graph_module.uuid,
        "uuid4",
        lambda: uuid.UUID(f"00000000-0000-4000-8000-{next(counter):012d}"),
    )


def _check(name: str, data: Any) -> None:
    path = FIXTURES_DIR / name
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if _UPDATE or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered, encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8")) == data, (
        f"{name} divergiu do runtime; rode com UPDATE_COPILOT_FIXTURES=1 e revise o contrato"
    )


def test_request_fixture_is_a_valid_request() -> None:
    body = request_body()
    CopilotRunRequest.model_validate(body)
    _check("run_request.json", body)


async def test_happy_turn_events_fixture() -> None:
    provider = ScriptedProvider(
        [tool_call_script("list_deals", {"idle_days": 7}, chunk=12), answer_script(ANSWER, chunk=24)]
    )
    events = await run_turn(provider, FakeNode({"list_deals": json_responder(ok_envelope())}))
    _EVENTS.validate_python(events)
    assert [e["type"] for e in events][0:2] == ["status", "tool_call_completed"]
    assert events[-1]["type"] == "final"
    _check("turn_events.json", events)


async def test_iteration_exceeded_events_fixture() -> None:
    provider = ScriptedProvider(
        [tool_call_script("list_deals", {"idle_days": i}, call_id=f"c{i}") for i in range(2)]
    )
    node = FakeNode({"list_deals": json_responder(ok_envelope())})
    events = await run_turn(provider, node, with_policy(max_iterations=2))
    _EVENTS.validate_python(events)
    assert "iteration_exceeded" in [e["type"] for e in events]
    assert events[-1]["format_fallback"] is True
    _check("turn_events_iteration_exceeded.json", events)


async def test_timeout_events_fixture() -> None:
    provider = ScriptedProvider([HANG])
    events = await run_turn(provider, FakeNode({}), with_policy(turn_timeout_s=0.2))
    _EVENTS.validate_python(events)
    assert events[-1] == {"type": "error", "code": "timeout"}
    _check("turn_events_timeout.json", events)


def test_fixture_files_are_all_checked() -> None:
    expected = {
        "run_request.json",
        "turn_events.json",
        "turn_events_iteration_exceeded.json",
        "turn_events_timeout.json",
    }
    assert {p.name for p in FIXTURES_DIR.glob("*.json")} == expected
