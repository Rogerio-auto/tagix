"""Modelos normalizados de resposta do OpenRouter.

Estes tipos são a fronteira estável entre o provider (HTTP cru do OpenRouter) e o
resto do runtime (grafo F2-S05, cost tracking F2-S13, hard-cap F2-S09). O grafo
nunca toca no shape cru do OpenRouter — consome `ChatResult` / `StreamDelta`.

Load-bearing para auditoria: `generation_id` (= `id` do OpenRouter) e
`upstream_provider` (= `provider`) viajam até `llm_usage_logs`. `Usage` carrega a
contagem de tokens e o custo (quando o OpenRouter já o devolve inline).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Usage(BaseModel):
    """Contabilidade de tokens + custo de uma chamada de chat completion.

    `cost_usd` vem inline quando o OpenRouter expõe `usage.cost` (depende do
    provider real); caso contrário fica `None` e o job assíncrono de F2-S13
    reconcilia via `GET /generation?id=` mais tarde.
    """

    model_config = ConfigDict(frozen=True)

    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float | None = None

    @classmethod
    def from_raw(cls, raw: dict[str, Any] | None) -> Usage:
        """Constrói a partir do bloco `usage` cru do OpenRouter (tolerante a None)."""
        raw = raw or {}
        details = raw.get("completion_tokens_details") or {}
        reasoning = raw.get("reasoning_tokens", details.get("reasoning_tokens", 0)) or 0
        return cls(
            prompt_tokens=int(raw.get("prompt_tokens", 0) or 0),
            completion_tokens=int(raw.get("completion_tokens", 0) or 0),
            reasoning_tokens=int(reasoning),
            total_tokens=int(raw.get("total_tokens", 0) or 0),
            cost_usd=raw.get("cost"),
        )


class ToolCall(BaseModel):
    """Uma chamada de função pedida pelo modelo (formato OpenAI/OpenRouter).

    `arguments` é a string JSON crua que o modelo emitiu (não desserializada
    aqui — o dispatcher de tools, F2-S05/S06, valida contra o schema Pydantic da
    tool). `index` é usado para remontar tool_calls fragmentados no streaming.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    arguments: str = ""
    index: int = 0

    def to_openai(self) -> dict[str, Any]:
        """Serializa de volta ao formato que entra no histórico de mensagens."""
        return {
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": self.arguments},
        }


class ChatResult(BaseModel):
    """Resultado normalizado de uma chat completion NÃO-stream.

    Tudo que o `call_model_node` precisa para (a) montar a `assistant` message,
    (b) decidir loop de tools, (c) registrar `llm_usage_logs`.
    """

    model_config = ConfigDict(frozen=True)

    content: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    finish_reason: str | None = None
    usage: Usage = Field(default_factory=Usage)
    generation_id: str | None = None
    upstream_provider: str | None = None
    model: str | None = None

    def to_assistant_message(self) -> dict[str, Any]:
        """Monta a mensagem `assistant` para anexar ao histórico do state.

        Casa com o `ChatMessage` do `app/types.py` (F2-S05): role/content/tool_calls.
        """
        msg: dict[str, Any] = {"role": "assistant", "content": self.content}
        if self.tool_calls:
            msg["tool_calls"] = [tc.to_openai() for tc in self.tool_calls]
        return msg


class StreamDelta(BaseModel):
    """Um incremento de um stream SSE do OpenRouter.

    Eventos possíveis num delta:
      - `content`: pedaço de texto do assistant (token-a-token).
      - `tool_call`: fragmento de uma tool call (nome no 1º delta, args fatiados).
      - `finish_reason`: presente no último delta com escolha.
      - `usage`: presente no chunk final quando `stream_options.include_usage`.

    O consumidor acumula `content` e remonta `tool_call`s por `index`.
    """

    model_config = ConfigDict(frozen=True)

    content: str | None = None
    tool_call: ToolCall | None = None
    finish_reason: str | None = None
    generation_id: str | None = None
    upstream_provider: str | None = None
    usage: Usage | None = None
