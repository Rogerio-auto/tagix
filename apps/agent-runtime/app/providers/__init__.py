"""Providers LLM do agent-runtime.

OpenRouter é o ÚNICO gateway de chat completion (ADR-022, travado). Embeddings,
transcription e vision-via-files saem por `openai_direct` (F3+; ainda não criado).

Uso (F2-S05 `call_model_node`):

    from app.providers import OpenRouterProvider, ChatResult

    provider = OpenRouterProvider()
    result = await provider.chat(
        model=agent["model"],
        messages=[m.model_dump() for m in state["messages"]],
        tools=[tool_to_openai_schema(t) for t in state["tools"]] or None,
        stream=False,
        max_tokens=policy.max_tokens_per_call,
        **agent.get("model_params", {}),
    )
    # result.content / result.tool_calls / result.usage / result.generation_id
"""

from __future__ import annotations

from .errors import (
    OpenRouterAuthError,
    OpenRouterConnectionError,
    OpenRouterError,
    OpenRouterModelError,
    OpenRouterRateLimitError,
    OpenRouterResponseError,
    OpenRouterTimeoutError,
    OpenRouterUpstreamError,
)
from .openrouter import OpenRouterProvider
from .types import ChatResult, StreamDelta, ToolCall, Usage

__all__ = [
    "ChatResult",
    "OpenRouterAuthError",
    "OpenRouterConnectionError",
    "OpenRouterError",
    "OpenRouterModelError",
    "OpenRouterProvider",
    "OpenRouterRateLimitError",
    "OpenRouterResponseError",
    "OpenRouterTimeoutError",
    "OpenRouterUpstreamError",
    "StreamDelta",
    "ToolCall",
    "Usage",
]
