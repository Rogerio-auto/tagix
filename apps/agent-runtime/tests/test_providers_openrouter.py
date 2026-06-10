"""Testes unitários do OpenRouterProvider.

Sem rede real: usamos `httpx.MockTransport` (nativo do httpx, sem dep nova) para
injetar respostas determinísticas. Cobre: parsing de completion + tool_calls +
usage/generation_id/provider, streaming SSE (texto + tool call + usage final),
mapeamento de erros tipados, e retry seletivo (429 -> sucesso; auth -> sem retry).
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from app.providers import (
    ChatResult,
    OpenRouterAuthError,
    OpenRouterModelError,
    OpenRouterProvider,
    OpenRouterRateLimitError,
    OpenRouterResponseError,
    OpenRouterUpstreamError,
    StreamDelta,
)


def _make_provider(
    handler: Callable[[httpx.Request], httpx.Response],
    *,
    max_retries: int = 2,
) -> OpenRouterProvider:
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(base_url="https://openrouter.ai/api/v1", transport=transport)
    return OpenRouterProvider(client=client, max_retries=max_retries)


def _completion_payload(*, with_tool: bool = False) -> dict:
    message: dict = {"role": "assistant", "content": "Olá, posso ajudar."}
    finish = "stop"
    if with_tool:
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_abc",
                    "type": "function",
                    "function": {"name": "query_contact", "arguments": '{"fields":["name"]}'},
                }
            ],
        }
        finish = "tool_calls"
    return {
        "id": "gen-12345",
        "provider": "openai",
        "model": "openai/gpt-4o-mini",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost": 0.0001},
    }


# --------------------------------------------------------------------- completion
async def test_chat_returns_normalized_result() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json=_completion_payload())

    provider = _make_provider(handler)
    result = await provider.chat(
        model="openai/gpt-4o-mini",
        messages=[{"role": "user", "content": "oi"}],
        max_tokens=256,
        temperature=0.7,
    )

    assert isinstance(result, ChatResult)
    assert result.content == "Olá, posso ajudar."
    assert result.tool_calls == []
    assert result.finish_reason == "stop"
    assert result.generation_id == "gen-12345"
    assert result.upstream_provider == "openai"
    assert result.usage.prompt_tokens == 10
    assert result.usage.completion_tokens == 5
    assert result.usage.total_tokens == 15
    assert result.usage.cost_usd == 0.0001
    # headers de atribuição + auth presentes; body carrega params extra e não força tools.
    assert captured["auth"] == "Bearer sk-or-test-key-not-real"
    assert captured["url"].endswith("/chat/completions")
    assert captured["body"]["max_tokens"] == 256
    assert captured["body"]["temperature"] == 0.7
    assert captured["body"]["stream"] is False
    assert "tools" not in captured["body"]
    await provider.aclose()


async def test_chat_parses_tool_calls() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_completion_payload(with_tool=True))

    provider = _make_provider(handler)
    result = await provider.chat(
        model="openai/gpt-4o-mini",
        messages=[{"role": "user", "content": "qual meu nome?"}],
        tools=[{"type": "function", "function": {"name": "query_contact", "parameters": {}}}],
    )
    assert isinstance(result, ChatResult)
    assert result.content is None
    assert len(result.tool_calls) == 1
    tc = result.tool_calls[0]
    assert tc.id == "call_abc"
    assert tc.name == "query_contact"
    assert json.loads(tc.arguments) == {"fields": ["name"]}
    assert result.finish_reason == "tool_calls"
    # to_assistant_message reanexa as tool_calls no formato OpenAI.
    msg = result.to_assistant_message()
    assert msg["role"] == "assistant"
    assert msg["tool_calls"][0]["function"]["name"] == "query_contact"
    await provider.aclose()


async def test_chat_completion_returns_raw_dict() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_completion_payload())

    provider = _make_provider(handler)
    raw = await provider.chat_completion(
        model="openai/gpt-4o-mini",
        messages=[{"role": "user", "content": "oi"}],
    )
    assert isinstance(raw, dict)
    assert raw["id"] == "gen-12345"
    assert raw["provider"] == "openai"
    assert raw["choices"][0]["finish_reason"] == "stop"
    await provider.aclose()


# ------------------------------------------------------------------------ streaming
def _sse(chunks: list[dict | str]) -> bytes:
    lines: list[str] = []
    for c in chunks:
        if isinstance(c, str):
            lines.append(c)
        else:
            lines.append(f"data: {json.dumps(c)}")
    lines.append("data: [DONE]")
    return ("\n\n".join(lines) + "\n\n").encode()


async def test_stream_yields_content_tool_and_usage() -> None:
    chunks: list[dict | str] = [
        ": OPENROUTER PROCESSING",
        {
            "id": "gen-stream",
            "provider": "anthropic",
            "choices": [{"index": 0, "delta": {"content": "Olá"}, "finish_reason": None}],
        },
        {
            "id": "gen-stream",
            "choices": [{"index": 0, "delta": {"content": " mundo"}, "finish_reason": None}],
        },
        {
            "id": "gen-stream",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_x",
                                "function": {"name": "mark_resolved", "arguments": "{}"},
                            }
                        ]
                    },
                    "finish_reason": None,
                }
            ],
        },
        {"id": "gen-stream", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        {
            "id": "gen-stream",
            "choices": [],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(
            200, content=_sse(chunks), headers={"content-type": "text/event-stream"}
        )

    provider = _make_provider(handler)
    stream = provider.chat(
        model="anthropic/claude-3.5-haiku",
        messages=[{"role": "user", "content": "oi"}],
        stream=True,
    )
    deltas: list[StreamDelta] = [d async for d in stream]  # type: ignore[union-attr]

    text = "".join(d.content for d in deltas if d.content)
    assert text == "Olá mundo"

    tool_deltas = [d for d in deltas if d.tool_call is not None]
    assert len(tool_deltas) == 1
    assert tool_deltas[0].tool_call.name == "mark_resolved"  # type: ignore[union-attr]

    finals = [d for d in deltas if d.finish_reason == "stop"]
    assert len(finals) == 1

    usage_deltas = [d for d in deltas if d.usage is not None]
    assert usage_deltas and usage_deltas[-1].usage.total_tokens == 5  # type: ignore[union-attr]
    await provider.aclose()


async def test_stream_raises_on_bad_json() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = b"data: {not valid json}\n\n"
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    provider = _make_provider(handler)
    with pytest.raises(OpenRouterResponseError):
        stream = provider.chat(model="m", messages=[], stream=True)
        _ = [d async for d in stream]  # type: ignore[union-attr]
    await provider.aclose()


# --------------------------------------------------------------------- error mapping
async def test_auth_error_not_retried() -> None:
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"message": "invalid key"}})

    provider = _make_provider(handler, max_retries=3)
    with pytest.raises(OpenRouterAuthError) as exc:
        await provider.chat(model="m", messages=[])
    assert exc.value.status_code == 401
    assert calls["n"] == 1  # auth nunca retria
    await provider.aclose()


async def test_model_error_mapped() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"message": "no such model"}})

    provider = _make_provider(handler, max_retries=1)
    with pytest.raises(OpenRouterModelError):
        await provider.chat(model="bogus/model", messages=[])
    await provider.aclose()


async def test_rate_limit_retries_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                429, headers={"retry-after": "0"}, json={"error": {"message": "slow down"}}
            )
        return httpx.Response(200, json=_completion_payload())

    provider = _make_provider(handler, max_retries=2)
    result = await provider.chat(model="m", messages=[])
    assert isinstance(result, ChatResult)
    assert calls["n"] == 2  # 1 falha + 1 sucesso
    await provider.aclose()


async def test_rate_limit_exhausts_retries() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "0"}, json={"error": "rate"})

    provider = _make_provider(handler, max_retries=1)
    with pytest.raises(OpenRouterRateLimitError):
        await provider.chat(model="m", messages=[])
    await provider.aclose()


async def test_upstream_5xx_retriable() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": {"message": "provider down"}})

    provider = _make_provider(handler, max_retries=1)
    with pytest.raises(OpenRouterUpstreamError) as exc:
        await provider.chat(model="m", messages=[])
    assert exc.value.retriable is True
    await provider.aclose()


async def test_malformed_completion_raises() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "x", "choices": []})

    provider = _make_provider(handler)
    with pytest.raises(OpenRouterResponseError):
        await provider.chat(model="m", messages=[])
    await provider.aclose()


async def test_get_generation_returns_cost() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "id=gen-12345" in str(request.url)
        return httpx.Response(200, json={"data": {"total_cost": 0.0002, "tokens_prompt": 10}})

    provider = _make_provider(handler)
    data = await provider.get_generation("gen-12345")
    assert data["data"]["total_cost"] == 0.0002
    await provider.aclose()


def test_api_key_never_in_exception_message() -> None:
    # Defesa: a mensagem de erro tipado nunca embute a chave.
    err = OpenRouterAuthError("OpenRouter 401: invalid key", status_code=401)
    assert "sk-or-test-key-not-real" not in str(err)
