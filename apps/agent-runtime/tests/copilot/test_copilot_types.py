"""Alinhamento de `app/copilot/types.py` com o Zod `packages/shared/src/copilot/internal.ts`.

O teste de contrato entre as duas pontas é do F73-S10 (o Node lê as fixtures). Aqui ficam
as regras que o Python precisa espelhar e que nenhum teste de fluxo exercita sozinho.
"""

from __future__ import annotations

from typing import Any

import pytest
from copilot_fakes import (
    FakeNode,
    ScriptedProvider,
    answer_script,
    json_responder,
    ok_envelope,
    request_body,
    run_turn,
    tool_call_script,
)
from pydantic import ValidationError

from app.copilot.answer import blocks_from_answer_args
from app.copilot.tools import SAFE_FAILURE_VIEW
from app.copilot.types import (
    COPILOT_POLICY_LIMITS,
    CopilotRunRequest,
    CopilotToolEnvelope,
    is_internal_route,
)
from app.providers import Usage


def test_policy_limits_mirror_the_zod_constants() -> None:
    assert dict(COPILOT_POLICY_LIMITS) == {
        "max_iterations": 8,
        "max_tool_calls": 16,
        "turn_timeout_s": 60,
        "history_max": 12,
        "memory_facts_max": 30,
    }


@pytest.mark.parametrize(
    "path,value",
    [
        (("policy", "max_iterations"), 9),
        (("policy", "max_tool_calls"), 17),
        (("policy", "turn_timeout_s"), 61),
        (("policy", "turn_timeout_s"), 0.5),
        (("memory", "facts", 0, "id"), "f-1"),
        (("memory", "profile", 0, "key"), "favorite_color"),
        (("member", "role_label"), "x" * 81),
        (("page_context_resolved", "entity_summary"), "x" * 1001),
        (("user_input",), "x" * 2001),
        (("turn_id",), "0b9f6a3e5d1c4f0e9a517c2d8e4b1a10"),  # uuid.UUID aceita; o Zod não
        (("tools", 0, "key"), "List_deals"),
    ],
    ids=[
        "iterations>8",
        "tool_calls>16",
        "timeout>60",
        "timeout-not-int",
        "fact-id-not-uuid",
        "unknown-profile-key",
        "role-label>80",
        "entity-summary>1000",
        "user-input>2000",
        "uuid-without-hyphens",
        "tool-key-uppercase",
    ],
)
def test_request_rejects_what_the_zod_rejects(path: tuple[Any, ...], value: Any) -> None:
    body = request_body()
    target: Any = body
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        CopilotRunRequest.model_validate(body)


@pytest.mark.parametrize(
    "field",
    ["page_context_resolved", "history", "memory", "tools", "policy"],
)
def test_request_fields_required_by_the_zod_are_required(field: str) -> None:
    body = request_body()
    del body[field]
    with pytest.raises(ValidationError):
        CopilotRunRequest.model_validate(body)


def test_member_locale_and_timezone_are_required() -> None:
    body = request_body()
    del body["member"]["timezone"]
    with pytest.raises(ValidationError):
        CopilotRunRequest.model_validate(body)


def test_fact_untrusted_is_optional_and_defaults_to_false() -> None:
    body = request_body()
    del body["memory"]["facts"][0]["untrusted"]
    req = CopilotRunRequest.model_validate(body)
    assert req.memory.facts[0].untrusted is False


@pytest.mark.parametrize(
    "envelope",
    [
        {"ok": True, "decision": "done", "model_view": "x"},  # decisão fora do enum
        {"ok": "true", "decision": "executed", "model_view": "x"},  # bool estrito
        {"ok": True, "decision": "executed", "model_view": "x", "untrusted": True},  # extra
        {"ok": True, "decision": "executed", "model_view": "x", "result_id": "r 1"},
        {"ok": True, "decision": "executed", "model_view": "x" * 24_577},
        {"ok": True, "decision": "executed", "model_view": 42},
        {"ok": True, "decision": "executed"},  # sem model_view
        {
            "ok": True,
            "decision": "executed",
            "model_view": "x",
            "public_event": {"type": "tool_result"},  # sem `v: 1`
        },
    ],
    ids=[
        "bad-decision",
        "non-bool-ok",
        "top-level-untrusted",
        "bad-result-id",
        "model-view-too-long",
        "model-view-number",
        "missing-model-view",
        "public-event-without-v",
    ],
)
def test_envelope_outside_the_contract_is_refused(envelope: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        CopilotToolEnvelope.model_validate(envelope)


async def test_envelope_outside_the_contract_becomes_safe_failure() -> None:
    bad = {**ok_envelope(), "untrusted": True}
    provider = ScriptedProvider(
        [tool_call_script("list_deals", {"idle_days": 7}), answer_script({"verdict": "x"})]
    )
    events = await run_turn(provider, FakeNode({"list_deals": json_responder(bad)}))
    completed = next(e for e in events if e["type"] == "tool_call_completed")
    assert completed["envelope"] == {
        "ok": False,
        "decision": "error",
        "model_view": SAFE_FAILURE_VIEW,
    }


def test_envelope_round_trips_without_inventing_fields() -> None:
    minimal = {"ok": False, "decision": "denied", "model_view": "Sem permissão."}
    dumped = CopilotToolEnvelope.model_validate(minimal).model_dump(mode="json")
    assert dumped == minimal  # `result_id`/`public_event` ausentes, nunca `null`
    full = ok_envelope()
    assert CopilotToolEnvelope.model_validate(full).model_dump(mode="json") == full


async def test_unknown_cost_makes_turn_cost_null_not_partial() -> None:
    no_cost = Usage(prompt_tokens=100, completion_tokens=20, cost_usd=None)
    provider = ScriptedProvider(
        [
            tool_call_script("list_deals", {"idle_days": 7}, usage=no_cost),
            answer_script({"verdict": "Três negócios parados."}),
        ]
    )
    events = await run_turn(provider, FakeNode({"list_deals": json_responder(ok_envelope())}))
    usage = events[-1]["usage"]
    assert usage == {"prompt_tokens": 200, "completion_tokens": 40, "total_cost_usd": None}


def test_answer_drops_sources_with_unverifiable_as_of_and_clamps_labels() -> None:
    blocks = blocks_from_answer_args(
        {
            "verdict": "ok",
            "sources": [
                {"label": "Pipeline", "as_of": "2026-10-16T09:30:00-03:00"},
                {"label": "Pipeline", "as_of": "16/10 às 09:30"},
                {"label": "Pipeline", "as_of": "2026-13-40T09:30:00Z"},
            ],
            "next_steps": [{"label": "x" * 200}],
        },
        allowed_refs=[],
    )
    assert [s.as_of for s in blocks.sources] == ["2026-10-16T09:30:00-03:00"]
    assert len(blocks.next_steps[0].label) <= 80


@pytest.mark.parametrize(
    "route,ok",
    [
        ("/pipeline", True),
        ("/conversations/123?tab=info", True),
        ("//evil.example", False),
        ("https://evil.example", False),
        ("/a\\b", False),
        ("/a b", False),
        ("/" + "a" * 300, False),
    ],
)
def test_internal_route_mirrors_the_zod(route: str, ok: bool) -> None:
    assert is_internal_route(route) is ok
