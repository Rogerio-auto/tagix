"""Node `call_model`: chama o OpenRouter (stream) e anexa a assistant message.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.2, §4.1, §11.

Responsabilidades:
  - Se `model_blocked_reason` já foi setado (load_context), pula a chamada e
    sinaliza para o grafo finalizar (o `/run` emite `model_blocked`).
  - Se a policy tem `remaining_monthly_budget_usd <= 0`, sinaliza `budget_exceeded`.
  - Monta o body (messages + tool specs via `registry.specs_for(...)`), chama o
    provider em **streaming** quando `policy.allow_streaming`, emitindo `token`
    events pelo `StreamWriter` do LangGraph (consumidos pelo `/run`). Sem stream,
    faz a chamada não-stream.
  - Acumula `usage` (tokens + custo) no state.
  - NÃO persiste `llm_usage_logs` aqui — a persistência é centralizada em
    `finalize` (uma transação por execução, sob workspace RLS). O usage agregado
    + `generation_id` viajam no state até lá.

O node é fábrica: recebe o `provider` e o `tool_registry` por injeção.
"""

from __future__ import annotations

from typing import Any

from langgraph.types import StreamWriter

from app.logging import get_logger
from app.providers import (
    ChatResult,
    OpenRouterAuthError,
    OpenRouterError,
    OpenRouterModelError,
    ToolCall,
)
from app.types import (
    AgentState,
    ChatMessage,
    PolicySnapshot,
    ToolRegistry,
    UsageAccumulator,
)

logger = get_logger()


def _budget_exhausted(policy: PolicySnapshot) -> bool:
    rem = policy.remaining_monthly_budget_usd
    return rem is not None and rem <= 0


def _tool_specs(state: AgentState, registry: ToolRegistry) -> list[dict[str, Any]] | None:
    keys = {t.key for t in state.get("tools", [])}
    if not keys:
        return None
    specs = registry.specs_for(keys)
    return specs or None


def _accumulate(prev: UsageAccumulator, result_usage: Any) -> UsageAccumulator:
    """Soma o usage de uma chamada ao acumulador do state."""
    return UsageAccumulator(
        prompt_tokens=prev.prompt_tokens + int(getattr(result_usage, "prompt_tokens", 0) or 0),
        completion_tokens=prev.completion_tokens
        + int(getattr(result_usage, "completion_tokens", 0) or 0),
        reasoning_tokens=prev.reasoning_tokens
        + int(getattr(result_usage, "reasoning_tokens", 0) or 0),
        total_tokens=prev.total_tokens + int(getattr(result_usage, "total_tokens", 0) or 0),
        total_cost_usd=prev.total_cost_usd + float(getattr(result_usage, "cost_usd", 0.0) or 0.0),
    )


def _assistant_message(content: str | None, tool_calls: list[ToolCall]) -> ChatMessage:
    return ChatMessage(
        role="assistant",
        content=content,
        tool_calls=[tc.to_openai() for tc in tool_calls] if tool_calls else None,
    )


def make_call_model_node(*, provider: Any, tool_registry: ToolRegistry):
    """Fábrica do node `call_model`, ligada a um provider e ao tool registry."""

    async def call_model_node(state: AgentState, writer: StreamWriter) -> dict[str, Any]:
        policy: PolicySnapshot = state["policy"]

        # Bloqueio de modelo (decidido em load_context) → não chama o LLM.
        if state.get("model_blocked_reason"):
            writer({"type": "model_blocked", "reason": state["model_blocked_reason"]})
            return {"final_reply": "", "should_handoff": True}

        # Hard-cap de budget (defesa-em-profundidade; o Node já barra antes).
        if _budget_exhausted(policy):
            writer({"type": "budget_exceeded"})
            return {"budget_exceeded": True, "final_reply": ""}

        agent = state.get("agent") or {}
        model = agent.get("model")
        if not model:
            writer({"type": "error", "message": "agent sem modelo configurado"})
            return {"final_reply": "", "errors": [*state.get("errors", []), "missing_model"]}

        messages = [m.to_openai() for m in state.get("messages", [])]
        tools = _tool_specs(state, tool_registry)
        model_params = dict(agent.get("model_params") or {})
        model_params.setdefault("max_tokens", policy.max_tokens_per_call)

        use_stream = policy.allow_streaming

        try:
            if use_stream:
                result = await _run_streaming(
                    provider=provider,
                    writer=writer,
                    model=model,
                    messages=messages,
                    tools=tools,
                    params=model_params,
                )
            else:
                result = await provider.chat(
                    model=model,
                    messages=messages,
                    tools=tools,
                    stream=False,
                    **model_params,
                )
        except OpenRouterModelError as exc:
            reason = str(exc)
            writer({"type": "model_blocked", "reason": reason})
            return {"model_blocked_reason": reason, "final_reply": "", "should_handoff": True}
        except OpenRouterAuthError as exc:
            writer({"type": "error", "message": "falha de autenticação no provider LLM"})
            return {
                "final_reply": "",
                "errors": [*state.get("errors", []), f"auth_error:{type(exc).__name__}"],
            }
        except OpenRouterError as exc:
            writer({"type": "error", "message": "falha ao chamar o provider LLM"})
            return {
                "final_reply": "",
                "errors": [*state.get("errors", []), f"provider_error:{type(exc).__name__}"],
            }

        assistant = _assistant_message(result.content, list(result.tool_calls))
        usage = _accumulate(state.get("usage") or UsageAccumulator(), result.usage)

        patch: dict[str, Any] = {
            "messages": [assistant],
            "usage": usage,
        }
        if result.generation_id:
            patch["generation_id"] = result.generation_id

        logger.debug(
            "call_model ok",
            model=str(model),
            tool_calls=len(result.tool_calls),
            finish=str(result.finish_reason),
        )
        return patch

    return call_model_node


async def _run_streaming(
    *,
    provider: Any,
    writer: StreamWriter,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    params: dict[str, Any],
) -> ChatResult:
    """Consome o stream do provider, emite `token` events e remonta o ChatResult."""
    content_parts: list[str] = []
    tool_acc: dict[int, dict[str, Any]] = {}
    finish_reason: str | None = None
    generation_id: str | None = None
    upstream: str | None = None
    final_usage: Any = None

    stream = provider.chat(
        model=model, messages=messages, tools=tools, stream=True, **params
    )
    async for delta in stream:  # type: StreamDelta
        if delta.content:
            content_parts.append(delta.content)
            writer({"type": "token", "content": delta.content})
        if delta.tool_call is not None:
            tc = delta.tool_call
            slot = tool_acc.setdefault(
                tc.index, {"id": "", "name": "", "arguments": ""}
            )
            if tc.id:
                slot["id"] = tc.id
            if tc.name:
                slot["name"] = tc.name
            if tc.arguments:
                slot["arguments"] += tc.arguments
        if delta.finish_reason:
            finish_reason = delta.finish_reason
        if delta.generation_id:
            generation_id = delta.generation_id
        if delta.upstream_provider:
            upstream = delta.upstream_provider
        if delta.usage is not None:
            final_usage = delta.usage

    tool_calls = [
        ToolCall(
            id=slot["id"] or f"call_{idx}",
            name=slot["name"],
            arguments=slot["arguments"],
            index=idx,
        )
        for idx, slot in sorted(tool_acc.items())
        if slot["name"]
    ]

    from app.providers import Usage  # local import: evita ciclo no topo

    return ChatResult(
        content="".join(content_parts) or None,
        tool_calls=tool_calls,
        finish_reason=finish_reason,
        usage=final_usage if final_usage is not None else Usage(),
        generation_id=generation_id,
        upstream_provider=upstream,
        model=model,
    )
