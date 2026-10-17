"""Grafo LangGraph do Copiloto (segundo grafo do runtime; `app/graph.py` fica intocado).

> **source:** `COPILOTO.md` §3, §5.4, §8 (R1, R5) · ADR-003 · ADR-004 §1.

    build_prompt → call_model ─┬→ tool_dispatch → call_model (loop)
                               └→ finalize → END

- **Sem checkpointer**: o histórico vem no request; o turno vive só em memória.
- **Sem banco**: toda ferramenta é callback ao Node com o grant (ADR-003 §6).
- **Ordem importa** (contaminação do turno, ADR-004 §6): `parallel_tool_calls=false` no
  modelo e execução estritamente sequencial no `tool_dispatch`.
- **Formato garantido por estrutura, não só por prompt**: `tool_choice="required"` em
  toda chamada (o modelo não tem como responder em texto livre se respeitar o
  protocolo) e `tool_choice=answer` forçado no último passo permitido e logo depois de
  uma proposta/bloqueio ("depois de propor, parar e resumir"). Modelo que ignora o
  protocolo cai no fallback de formato do `finalize`.
- **Limites da policy**: `max_iterations` (chamadas ao modelo) e `max_tool_calls`
  (callbacks ao Node). Estourar o teto emite `iteration_exceeded` e um `final` com
  `format_fallback=true`.

Eventos (via `StreamWriter`, `stream_mode="custom"`): `verdict_delta` durante o stream
dos args de `answer`; `status` antes e `tool_call_completed` depois de cada callback;
`iteration_exceeded`; `final`; `error` (falha do provider).
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Final, Literal

import httpx
from langgraph.graph import END, StateGraph
from langgraph.types import StreamWriter

from app.config import Settings
from app.copilot.answer import (
    ANSWER_TOOL_SPEC,
    NO_ANSWER_VERDICT,
    VerdictStreamer,
    blocks_from_answer_args,
    clamp_verdict,
    fallback_blocks,
    parse_answer_arguments,
)
from app.copilot.prompt import build_messages, render_tool_message
from app.copilot.tools import (
    SAFE_INVALID_ARGS_VIEW,
    SAFE_LIMIT_VIEW,
    SAFE_STOPPED_VIEW,
    SAFE_UNKNOWN_TOOL_VIEW,
    build_callback_tools,
    failure_envelope,
)
from app.copilot.types import (
    ANSWER_TOOL_NAME,
    AnswerBlocks,
    CopilotState,
    CopilotUsage,
    ErrorEvent,
    FinalEvent,
    IterationExceededEvent,
    StatusEvent,
    ToolCallCompletedEvent,
    VerdictDeltaEvent,
    event_payload,
)
from app.logging import get_logger
from app.providers import OpenRouterError

logger = get_logger()

# Decisões do Node que encerram o uso de ferramentas no turno (ADR-004 §1).
_STOP_DECISIONS: Final = frozenset({"proposed", "blocked", "denied"})
_FORCE_ANSWER_CHOICE: Final = {"type": "function", "function": {"name": ANSWER_TOOL_NAME}}


def _emit(writer: StreamWriter, event: Any) -> None:
    writer(event_payload(event))


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


def build_prompt_node(state: CopilotState) -> dict[str, Any]:
    return {"messages": build_messages(state["request"])}


def _accumulate_usage(prev: CopilotUsage, usage: Any) -> CopilotUsage:
    """Soma o uso de uma chamada ao do turno.

    Custo desconhecido em qualquer chamada (OpenRouter sem `usage.cost`, ou chamada sem
    `usage`) torna o custo do turno `null`: uma soma parcial pareceria exata e iria para
    `llm_usage_logs`. A API reconcilia pelo `generation_id` quando precisar.
    """
    if usage is None:
        return prev.model_copy(update={"total_cost_usd": None})
    cost = getattr(usage, "cost_usd", None)
    total = (
        None if prev.total_cost_usd is None or cost is None else prev.total_cost_usd + float(cost)
    )
    return CopilotUsage(
        prompt_tokens=prev.prompt_tokens + int(getattr(usage, "prompt_tokens", 0) or 0),
        completion_tokens=prev.completion_tokens + int(getattr(usage, "completion_tokens", 0) or 0),
        total_cost_usd=total,
    )


def make_call_model_node(*, provider: Any, http_client: httpx.AsyncClient, settings: Settings):
    async def call_model_node(state: CopilotState, writer: StreamWriter) -> dict[str, Any]:
        req = state["request"]
        iterations = state.get("iterations", 0) + 1
        force = bool(state.get("force_answer")) or iterations >= req.policy.max_iterations

        tools = build_callback_tools(req.tools, http_client=http_client, settings=settings)
        specs = [tool.openai_spec() for tool in tools.values()] + [ANSWER_TOOL_SPEC]
        params: dict[str, Any] = {
            "max_tokens": req.policy.max_tokens_per_call,
            "temperature": req.policy.temperature,
            "parallel_tool_calls": False,
            "tool_choice": _FORCE_ANSWER_CHOICE if force else "required",
        }

        streamer = VerdictStreamer()
        answer_index: int | None = None
        slots: dict[int, dict[str, Any]] = {}
        content_parts: list[str] = []
        usage = state.get("usage") or CopilotUsage()
        call_usage: Any = None

        try:
            stream = provider.chat(
                model=state["model"],
                messages=state.get("messages", []),
                tools=specs,
                stream=True,
                **params,
            )
            async for delta in stream:
                if delta.content:
                    content_parts.append(delta.content)
                if delta.usage is not None:
                    call_usage = delta.usage
                tc = delta.tool_call
                if tc is None:
                    continue
                slot = slots.setdefault(tc.index, {"id": "", "name": "", "arguments": "", "fed": 0})
                if tc.id:
                    slot["id"] = tc.id
                if tc.name:
                    slot["name"] = tc.name
                if tc.arguments:
                    slot["arguments"] += tc.arguments
                if slot["name"] == ANSWER_TOOL_NAME and answer_index in (None, tc.index):
                    answer_index = tc.index
                    fresh = slot["arguments"][slot["fed"] :]
                    slot["fed"] = len(slot["arguments"])
                    text = streamer.feed(fresh)
                    if text:
                        _emit(writer, VerdictDeltaEvent(text=text))
        except OpenRouterError as exc:
            logger.warning(
                "copilot call_model: falha do provider",
                error=type(exc).__name__,
                status=exc.status_code,
            )
            _emit(writer, ErrorEvent(code="provider_error"))
            return {
                "failed": True,
                "iterations": iterations,
                "usage": _accumulate_usage(usage, call_usage),
            }

        calls = [
            {
                "id": slot["id"] or f"call_{idx}_{iterations}",
                "name": slot["name"],
                "arguments": slot["arguments"],
            }
            for idx, slot in sorted(slots.items())
            if slot["name"]
        ]
        content = "".join(content_parts) or None
        assistant: dict[str, Any] = {"role": "assistant", "content": content}
        if calls:
            assistant["tool_calls"] = [
                {
                    "id": c["id"],
                    "type": "function",
                    "function": {"name": c["name"], "arguments": c["arguments"]},
                }
                for c in calls
            ]

        answer = next((c for c in calls if c["name"] == ANSWER_TOOL_NAME), None)
        patch: dict[str, Any] = {
            "messages": [assistant],
            "iterations": iterations,
            "usage": _accumulate_usage(usage, call_usage),
            "force_answer": False,
            "pending_tool_calls": [] if answer else [c for c in calls],
        }
        if content and content.strip():
            patch["last_text"] = content
        if answer is not None:
            patch["answer_arguments"] = answer["arguments"]
            patch["streamed_verdict"] = streamer.text
        logger.debug(
            "copilot call_model ok",
            iteration=iterations,
            tool_calls=len(calls),
            answered=answer is not None,
        )
        return patch

    return call_model_node


def _parse_args(raw: str) -> dict[str, Any] | None:
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def make_tool_dispatch_node(*, http_client: httpx.AsyncClient, settings: Settings):
    async def tool_dispatch_node(state: CopilotState, writer: StreamWriter) -> dict[str, Any]:
        req = state["request"]
        tools = build_callback_tools(req.tools, http_client=http_client, settings=settings)
        made = state.get("tool_calls_made", 0)
        messages: list[dict[str, Any]] = []
        result_ids: list[str] = []
        force = False
        stopped = False

        def reply(call_id: str, content: str) -> None:
            messages.append({"role": "tool", "tool_call_id": call_id, "content": content})

        def reject(call: dict[str, str], view: str) -> None:
            # Recusa local: nada foi ao Node; o modelo recebe uma explicação estável.
            reply(call["id"], render_tool_message(call["name"], failure_envelope(view)))

        for call in state.get("pending_tool_calls", []):
            name = call["name"]
            if stopped:
                reject(call, SAFE_STOPPED_VIEW)
                continue
            tool = tools.get(name)
            if tool is None:
                reject(call, SAFE_UNKNOWN_TOOL_VIEW)
                continue
            args = _parse_args(call["arguments"])
            if args is None:
                reject(call, SAFE_INVALID_ARGS_VIEW)
                continue
            if made >= req.policy.max_tool_calls:
                force = True
                reject(call, SAFE_LIMIT_VIEW)
                continue

            made += 1
            call_id = str(uuid.uuid4())
            _emit(writer, StatusEvent(tool_key=name))
            outcome = await tool.call(
                turn_id=req.turn_id,
                grant=req.grant.get_secret_value(),
                call_id=call_id,
                args=args,
            )
            envelope = outcome.envelope
            _emit(
                writer,
                ToolCallCompletedEvent(tool_key=name, call_id=call_id, envelope=envelope),
            )
            result_id = envelope.get("result_id")
            if outcome.from_node and isinstance(result_id, str) and result_id:
                result_ids.append(result_id)
            reply(call["id"], render_tool_message(name, envelope))
            if envelope.get("decision") in _STOP_DECISIONS:
                force = True
                stopped = True

        return {
            "messages": messages,
            "result_ids": result_ids,
            "tool_calls_made": made,
            "pending_tool_calls": [],
            "force_answer": force,
        }

    return tool_dispatch_node


def finalize_node(state: CopilotState, writer: StreamWriter) -> dict[str, Any]:
    answer_arguments = state.get("answer_arguments")
    exceeded = answer_arguments is None and bool(state.get("pending_tool_calls"))
    if exceeded:
        _emit(writer, IterationExceededEvent())

    streamed = state.get("streamed_verdict", "")
    last_text = state.get("last_text")
    format_fallback = True
    if answer_arguments is not None:
        args = parse_answer_arguments(answer_arguments)
        if args is not None:
            blocks = blocks_from_answer_args(args, allowed_refs=state.get("result_ids", []))
            format_fallback = not blocks.verdict
            if not blocks.verdict:
                verdict = streamed or fallback_blocks(last_text).verdict
                blocks = blocks.model_copy(update={"verdict": verdict})
        else:
            # Args truncados ou malformados: aproveita o que já saiu em stream.
            blocks = AnswerBlocks(verdict=streamed) if streamed else fallback_blocks(last_text)
    else:
        blocks = fallback_blocks(last_text)
    if not blocks.verdict:
        blocks = blocks.model_copy(update={"verdict": clamp_verdict(NO_ANSWER_VERDICT)})

    # O veredito final é sempre a concatenação dos deltas: completa o que faltar.
    if blocks.verdict.startswith(streamed):
        rest = blocks.verdict[len(streamed) :]
        if rest:
            _emit(writer, VerdictDeltaEvent(text=rest))
    else:  # pragma: no cover - só com bug no parser incremental
        logger.warning("copilot finalize: veredito final diverge do stream")

    _emit(
        writer,
        FinalEvent(
            blocks=blocks,
            usage=state.get("usage") or CopilotUsage(),
            iterations=state.get("iterations", 0),
            format_fallback=format_fallback,
        ),
    )
    return {"pending_tool_calls": []}


# ---------------------------------------------------------------------------
# Arestas
# ---------------------------------------------------------------------------


def route_after_model(state: CopilotState) -> Literal["tool_dispatch", "finalize", "end"]:
    if state.get("failed"):
        return "end"
    if state.get("answer_arguments") is not None:
        return "finalize"
    if not state.get("pending_tool_calls"):
        return "finalize"
    if state.get("iterations", 0) >= state["request"].policy.max_iterations:
        return "finalize"
    return "tool_dispatch"


def build_copilot_graph(*, provider: Any, http_client: httpx.AsyncClient, settings: Settings):
    """Compila o grafo do Copiloto. Uma instância por processo (lifespan); estado por turno."""
    builder: StateGraph = StateGraph(CopilotState)
    builder.add_node("build_prompt", build_prompt_node)
    builder.add_node(
        "call_model",
        make_call_model_node(provider=provider, http_client=http_client, settings=settings),
    )
    builder.add_node(
        "tool_dispatch", make_tool_dispatch_node(http_client=http_client, settings=settings)
    )
    builder.add_node("finalize", finalize_node)

    builder.set_entry_point("build_prompt")
    builder.add_edge("build_prompt", "call_model")
    builder.add_conditional_edges(
        "call_model",
        route_after_model,
        {"tool_dispatch": "tool_dispatch", "finalize": "finalize", "end": END},
    )
    builder.add_edge("tool_dispatch", "call_model")
    builder.add_edge("finalize", END)
    return builder.compile()


def recursion_limit(max_iterations: int) -> int:
    """Passos do LangGraph: 2 por iteração (modelo + ferramentas) + prompt + finalize."""
    return max_iterations * 2 + 4
