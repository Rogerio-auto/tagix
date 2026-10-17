"""Fakes do Copiloto: provider roteirizado, Node via `httpx.MockTransport`, helpers.

Nenhum teste chama o OpenRouter real nem o Node real. O provider devolve, a cada
chamada, o próximo roteiro de `StreamDelta` (fatiados como o OpenRouter faz: nome da
ferramenta no 1º delta, argumentos em pedaços pequenos, `usage` no último).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from copy import deepcopy
from pathlib import Path
from typing import Any

import httpx

from app.config import get_settings
from app.copilot.graph import build_copilot_graph
from app.copilot.route import stream_copilot_turn
from app.copilot.types import CopilotRunRequest
from app.providers import StreamDelta, ToolCall, Usage

FIXTURES_DIR = Path(__file__).parent / "fixtures"

TURN_ID = "0b9f6a3e-5d1c-4f0e-9a51-7c2d8e4b1a10"
WORKSPACE_ID = "6e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"
GRANT = "eyJ2IjoxLCJ0aWQiOiJmaXh0dXJlIn0.ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz"
RUNTIME_TOKEN = "test-internal-token"
FACT_ID = "3c8e1f4a-7b2d-4e9a-8c6f-1a2b3c4d5e6f"
STAGE_ID = "9d4c2b1a-0e8f-4a7b-9c6d-5e4f3a2b1c0d"
DEAL_IDS = (
    "a1b2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d",
    "a1b2c3d4-0002-4a5b-8c6d-7e8f9a0b1c2d",
    "a1b2c3d4-0003-4a5b-8c6d-7e8f9a0b1c2d",
)


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


def query_tool_descriptor(key: str = "list_deals") -> dict[str, Any]:
    return {
        "key": key,
        "description": "Lista negócios do pipeline sob o escopo de quem pede.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "stage": {"type": "string"},
                "idle_days": {"type": "integer", "minimum": 0},
            },
        },
    }


def request_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "turn_id": TURN_ID,
        "workspace_id": WORKSPACE_ID,
        "grant": GRANT,
        "member": {
            "display_name": "Bruna Lima",
            "role_label": "Gestora",
            "locale": "pt-BR",
            "timezone": "America/Sao_Paulo",
        },
        "now_iso": "2026-10-16T09:30:00-03:00",
        "page_context_resolved": {
            "label": "Pipeline Alinhadores",
            "entity_summary": "Estágio Proposta enviada: 7 negócios abertos.",
        },
        "history": [
            {"role": "user", "content": "Como está o pipeline de alinhadores?"},
            {"role": "assistant", "content": "Está com 18 negócios abertos."},
        ],
        "memory": {
            "profile": [{"key": "what_we_sell", "content": "Alinhadores ortodônticos."}],
            "facts": [
                {
                    "id": FACT_ID,
                    "content": "Ticket médio de alinhadores é R$ 6.800.",
                    "source_label": "Bruna, 02/10",
                    "untrusted": False,
                }
            ],
        },
        "tools": [query_tool_descriptor()],
        "policy": {
            "model": "openai/gpt-4.1-mini",
            "max_iterations": 8,
            "max_tool_calls": 16,
            "max_tokens_per_call": 1024,
            "temperature": 0.2,
            "turn_timeout_s": 60,
        },
        "user_input": "Quais negócios estão parados há mais de 7 dias?",
    }
    body.update(overrides)
    return body


def make_request(**overrides: Any) -> CopilotRunRequest:
    return CopilotRunRequest.model_validate(request_body(**overrides))


def with_policy(**policy: Any) -> CopilotRunRequest:
    body = request_body()
    body["policy"] = {**body["policy"], **policy}
    return CopilotRunRequest.model_validate(body)


# ---------------------------------------------------------------------------
# Roteiros de stream do modelo
# ---------------------------------------------------------------------------


def _chunks(text: str, size: int) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]


def tool_call_script(
    name: str,
    args: dict[str, Any] | str,
    *,
    call_id: str = "call_1",
    index: int = 0,
    chunk: int = 5,
    usage: Usage | None = None,
) -> list[StreamDelta]:
    raw = args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)
    deltas = [
        StreamDelta(
            tool_call=ToolCall(
                id=call_id if i == 0 else "",
                name=name if i == 0 else "",
                arguments=piece,
                index=index,
            )
        )
        for i, piece in enumerate(_chunks(raw, chunk))
    ]
    deltas.append(
        StreamDelta(
            finish_reason="tool_calls",
            usage=usage or Usage(prompt_tokens=100, completion_tokens=20, cost_usd=0.0001),
            generation_id="gen-test",
        )
    )
    return deltas


def answer_script(args: dict[str, Any] | str, *, chunk: int = 4) -> list[StreamDelta]:
    return tool_call_script("answer", args, call_id="call_answer", chunk=chunk)


def text_script(text: str) -> list[StreamDelta]:
    return [
        *(StreamDelta(content=piece) for piece in _chunks(text, 6)),
        StreamDelta(
            finish_reason="stop",
            usage=Usage(prompt_tokens=80, completion_tokens=15, cost_usd=0.00005),
        ),
    ]


HANG = "hang"


class ScriptedProvider:
    """Provider fake: cada `chat(stream=True)` consome o próximo roteiro.

    O roteiro `HANG` emite um delta de veredito e fica preso até ser cancelado
    (timeout/desconexão); `cancelled` registra que o cancelamento chegou ao stream.
    """

    def __init__(self, scripts: list[list[StreamDelta] | str]) -> None:
        self._scripts = list(scripts)
        self.calls: list[dict[str, Any]] = []
        self.cancelled = asyncio.Event()
        self.hanging = asyncio.Event()

    def chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **params: Any,
    ) -> AsyncIterator[StreamDelta]:
        assert stream, "o Copiloto sempre usa streaming"
        self.calls.append(
            {"model": model, "messages": deepcopy(messages), "tools": tools, "params": params}
        )
        if not self._scripts:
            raise AssertionError("provider fake chamado mais vezes que o roteiro")
        return self._run(self._scripts.pop(0))

    async def _run(self, script: list[StreamDelta] | str) -> AsyncIterator[StreamDelta]:
        if script == HANG:
            yield StreamDelta(
                tool_call=ToolCall(
                    id="call_h", name="answer", arguments='{"verdict":"Parc', index=0
                )
            )
            try:
                self.hanging.set()
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
            return
        for delta in script:
            await asyncio.sleep(0)
            yield delta


# ---------------------------------------------------------------------------
# Node (callback) via MockTransport
# ---------------------------------------------------------------------------


class FakeNode:
    """Lado Node do callback: roteia por `tool_key` e grava cada requisição."""

    def __init__(self, responders: dict[str, Callable[[dict[str, Any]], httpx.Response]]) -> None:
        self._responders = responders
        self.requests: list[dict[str, Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        key = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content)
        self.requests.append(
            {
                "path": request.url.path,
                "authorization": request.headers.get("authorization"),
                "grant": request.headers.get("x-copilot-grant"),
                "body": body,
            }
        )
        responder = self._responders.get(key)
        if responder is None:
            return httpx.Response(404, json={"error": "tool_not_found"})
        return responder(body)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


_DEALS = (
    ("Ana · Alinhadores", "Ana", 6800, 9),
    ("Caio · Alinhadores", "Caio", 7200, 12),
    ("Lia · Alinhadores", "Lia", 5900, 8),
)


def deal_list_public_event(result_id: str) -> dict[str, Any]:
    """`tool_result` `deal_list` no formato do Zod (`DealListCardSchema` + `v`/`type`)."""
    return {
        "v": 1,
        "type": "tool_result",
        "kind": "deal_list",
        "result_id": result_id,
        "source": {"label": "Pipeline", "as_of": "2026-10-16T09:30:00-03:00", "record_count": 3},
        "truncated": False,
        "data": {
            "currency": "BRL",
            "total": 3,
            "items": [
                {
                    "deal_id": deal_id,
                    "title": title,
                    "contact_name": contact,
                    "value": value,
                    "stage": {"stage_id": STAGE_ID, "name": "Proposta enviada"},
                    "owner_name": "Bruna Lima",
                    "idle_days": idle,
                }
                for deal_id, (title, contact, value, idle) in zip(DEAL_IDS, _DEALS, strict=True)
            ],
        },
    }


def ok_envelope(result_id: str = "r-deals-1", **extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "decision": "executed",
        "result_id": result_id,
        "model_view": {
            "count": 3,
            "deals": [
                {"id": "d1", "title": "Ana · Alinhadores", "value": 6800, "idle_days": 9},
                {"id": "d2", "title": "Caio · Alinhadores", "value": 7200, "idle_days": 12},
                {"id": "d3", "title": "Lia · Alinhadores", "value": 5900, "idle_days": 8},
            ],
        },
        "public_event": deal_list_public_event(result_id),
        **extra,
    }


def json_responder(payload: dict[str, Any], status: int = 200):
    def respond(_body: dict[str, Any]) -> httpx.Response:
        return httpx.Response(status, json=payload)

    return respond


# ---------------------------------------------------------------------------
# Execução de um turno
# ---------------------------------------------------------------------------


def build_graph(provider: ScriptedProvider, node: FakeNode):
    return build_copilot_graph(
        provider=provider, http_client=node.client(), settings=get_settings()
    )


def parse_frames(frames: list[str]) -> list[dict[str, Any]]:
    events = []
    for frame in frames:
        assert frame.startswith("data: ") and frame.endswith("\n\n"), frame
        events.append(json.loads(frame[len("data: ") : -2]))
    return events


async def run_turn(
    provider: ScriptedProvider, node: FakeNode, req: CopilotRunRequest | None = None
) -> list[dict[str, Any]]:
    graph = build_graph(provider, node)
    frames = [
        frame async for frame in stream_copilot_turn(graph, req or make_request(), get_settings())
    ]
    return parse_frames(frames)


def types_of(events: list[dict[str, Any]]) -> list[str]:
    return [e["type"] for e in events]
