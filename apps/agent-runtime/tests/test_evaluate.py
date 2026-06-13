"""Testes do LLM-judge e do endpoint /internal/evaluate (F29-S02).

Sem rede e sem DB real: o OpenRouterProvider e injetado com httpx.MockTransport
(mesmo padrao de test_providers_openrouter / test_embeddings); o transcript e o
log de uso sao monkeypatchados. O judge real (OpenRouter) NAO e exercido em CI
(custa dinheiro + precisa de key) — validamos contra mock; E2E real precisa key.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

import app.routes.evaluate as evaluate_module
from app.evaluation.judge import (
    EvaluationOutcome,
    JudgeError,
    JudgeInvalidOutputError,
    _parse_result,
    evaluate_conversation,
)
from app.evaluation.prompt import TranscriptLine, render_transcript
from app.evaluation.schema import JudgeResult
from app.providers.openrouter import OpenRouterProvider

WS = "11111111-1111-1111-1111-111111111111"
CONV = "22222222-2222-2222-2222-222222222222"
AUTH = {"Authorization": "Bearer test-internal-token"}

_VALID_JUDGE_JSON = {
    "quality_score": 78,
    "quality_rationale": "Clear and resolved.",
    "sentiment_score": 30,
    "csat_label": "promoter",
    "handled_by": "human",
    "objections": [
        {"category": "price", "label": "Too expensive", "excerpt": "it is pricey", "resolved": True}
    ],
}


def _make_provider(handler: Callable[[httpx.Request], httpx.Response]) -> OpenRouterProvider:
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="https://openrouter.ai/api/v1")
    return OpenRouterProvider(client=client, max_retries=0)


def _completion_payload(content: dict | str) -> dict:
    text = content if isinstance(content, str) else json.dumps(content)
    return {
        "id": "gen-abc",
        "provider": "openai",
        "model": "openai/gpt-4o-mini",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}
        ],
        "usage": {
            "prompt_tokens": 120,
            "completion_tokens": 40,
            "total_tokens": 160,
            "cost": 0.00021,
        },
    }


def test_parse_valid_output() -> None:
    res = _parse_result(json.dumps(_VALID_JUDGE_JSON))
    assert res.quality_score == 78
    assert res.csat_label == "promoter"
    assert res.handled_by == "human"
    assert len(res.objections) == 1
    assert res.objections[0].category == "price"


def test_parse_empty_raises() -> None:
    with pytest.raises(JudgeInvalidOutputError):
        _parse_result("")


def test_parse_non_json_raises() -> None:
    with pytest.raises(JudgeInvalidOutputError):
        _parse_result("not json at all")


def test_parse_non_object_raises() -> None:
    with pytest.raises(JudgeInvalidOutputError):
        _parse_result("[1, 2, 3]")


def test_parse_out_of_range_score_raises() -> None:
    bad = {**_VALID_JUDGE_JSON, "quality_score": 150}
    with pytest.raises(JudgeInvalidOutputError):
        _parse_result(json.dumps(bad))


def test_parse_bad_category_raises() -> None:
    bad = {**_VALID_JUDGE_JSON, "objections": [{"category": "weather", "label": "x"}]}
    with pytest.raises(JudgeInvalidOutputError):
        _parse_result(json.dumps(bad))


def test_parse_null_sentiment_ok() -> None:
    payload = {
        "quality_score": 50,
        "sentiment_score": None,
        "csat_label": None,
        "handled_by": "ai",
        "objections": [],
    }
    res = _parse_result(json.dumps(payload))
    assert res.sentiment_score is None
    assert res.csat_label is None
    assert res.objections == []


def test_render_transcript_roles() -> None:
    lines = [
        TranscriptLine(role="contact", content="hi"),
        TranscriptLine(role="human", content="hello there"),
        TranscriptLine(role="ai", content="bot reply"),
    ]
    rendered = render_transcript(lines)
    assert "contact: hi" in rendered
    assert "human: hello" in rendered
    assert "ai: bot reply" in rendered


def test_render_transcript_empty() -> None:
    assert "empty" in render_transcript([])


async def test_evaluate_conversation_happy_path(monkeypatch) -> None:
    async def fake_transcript(pool, ws, conv):
        return [TranscriptLine(role="contact", content="too expensive")]

    monkeypatch.setattr("app.evaluation.judge._load_transcript", fake_transcript)
    monkeypatch.setattr("app.evaluation.judge.get_pool", lambda: object())
    provider = _make_provider(
        lambda r: httpx.Response(200, json=_completion_payload(_VALID_JUDGE_JSON))
    )

    outcome = await evaluate_conversation(
        provider=provider,
        judge_model="openai/gpt-4o-mini",
        workspace_id=WS,
        conversation_id=CONV,
    )
    assert isinstance(outcome.result, JudgeResult)
    assert outcome.result.quality_score == 78
    assert outcome.cost_usd == pytest.approx(0.00021)
    assert outcome.total_tokens == 160
    assert outcome.generation_id == "gen-abc"


async def test_evaluate_conversation_invalid_output_raises(monkeypatch) -> None:
    async def fake_transcript(pool, ws, conv):
        return [TranscriptLine(role="contact", content="hi")]

    monkeypatch.setattr("app.evaluation.judge._load_transcript", fake_transcript)
    monkeypatch.setattr("app.evaluation.judge.get_pool", lambda: object())
    provider = _make_provider(
        lambda r: httpx.Response(200, json=_completion_payload("broken { json"))
    )

    with pytest.raises(JudgeInvalidOutputError):
        await evaluate_conversation(
                provider=provider,
            judge_model="m",
            workspace_id=WS,
            conversation_id=CONV,
        )


async def test_evaluate_conversation_upstream_error_raises(monkeypatch) -> None:
    async def fake_transcript(pool, ws, conv):
        return [TranscriptLine(role="contact", content="hi")]

    monkeypatch.setattr("app.evaluation.judge._load_transcript", fake_transcript)
    monkeypatch.setattr("app.evaluation.judge.get_pool", lambda: object())
    provider = _make_provider(
        lambda r: httpx.Response(500, json={"error": {"message": "boom"}})
    )

    with pytest.raises(JudgeError):
        await evaluate_conversation(
                provider=provider,
            judge_model="m",
            workspace_id=WS,
            conversation_id=CONV,
        )


def _outcome() -> EvaluationOutcome:
    return EvaluationOutcome(
        result=JudgeResult.model_validate(_VALID_JUDGE_JSON),
        model="openai/gpt-4o-mini",
        cost_usd=0.00021,
        prompt_tokens=120,
        completion_tokens=40,
        total_tokens=160,
        generation_id="gen-abc",
        upstream_provider="openai",
    )


def _client(monkeypatch, *, outcome=None, raises=None, logged=None) -> TestClient:
    from app.main import create_app

    async def fake_evaluate(**kwargs):
        if raises is not None:
            raise raises
        return outcome

    async def fake_log(workspace_id, oc) -> None:
        if logged is not None:
            logged.append((workspace_id, oc))

    monkeypatch.setattr(evaluate_module, "evaluate_conversation", fake_evaluate)
    monkeypatch.setattr(evaluate_module, "_log_usage", fake_log)

    app = create_app()
    app.state.judge_provider = _make_provider(
        lambda r: httpx.Response(200, json=_completion_payload(_VALID_JUDGE_JSON))
    )
    app.state.judge_model = "openai/gpt-4o-mini"
    return TestClient(app)


def test_endpoint_requires_token(monkeypatch) -> None:
    logged: list = []
    client = _client(monkeypatch, outcome=_outcome(), logged=logged)
    resp = client.post("/internal/evaluate", json={"workspace_id": WS, "conversation_id": CONV})
    assert resp.status_code == 401
    assert logged == []


def test_endpoint_evaluates_and_logs(monkeypatch) -> None:
    logged: list = []
    client = _client(monkeypatch, outcome=_outcome(), logged=logged)
    resp = client.post(
        "/internal/evaluate", json={"workspace_id": WS, "conversation_id": CONV}, headers=AUTH
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["result"]["quality_score"] == 78
    assert body["result"]["objections"][0]["category"] == "price"
    assert body["judge_model"] == "openai/gpt-4o-mini"
    assert body["judge_cost_usd"] == pytest.approx(0.00021)
    assert len(logged) == 1


def test_endpoint_422_on_invalid_judge_output(monkeypatch) -> None:
    logged: list = []
    client = _client(monkeypatch, raises=JudgeInvalidOutputError("bad"), logged=logged)
    resp = client.post(
        "/internal/evaluate", json={"workspace_id": WS, "conversation_id": CONV}, headers=AUTH
    )
    assert resp.status_code == 422
    assert logged == []


def test_endpoint_502_on_upstream_failure(monkeypatch) -> None:
    logged: list = []
    client = _client(monkeypatch, raises=JudgeError("boom"), logged=logged)
    resp = client.post(
        "/internal/evaluate", json={"workspace_id": WS, "conversation_id": CONV}, headers=AUTH
    )
    assert resp.status_code == 502
    assert logged == []
