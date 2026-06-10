"""Cliente OpenRouter — o ÚNICO gateway LLM do runtime (ADR-022, travado).

`OpenRouterProvider` fala HTTP com `https://openrouter.ai/api/v1` via `httpx`
async e devolve resultados *normalizados* (`ChatResult` / `StreamDelta`), nunca o
shape cru do OpenRouter. Cobre:

  - chat completion não-stream  -> `await provider.chat(...) -> ChatResult`
  - streaming token-a-token     -> `provider.chat(..., stream=True) -> AsyncIterator[StreamDelta]`
  - tool calling (formato OpenAI/function-calling), inclusive remontagem no stream
  - captura de `generation_id` + `upstream_provider` + `usage` para `llm_usage_logs`
  - mapeamento de erro upstream -> exceções tipadas (ver `errors.py`)
  - retry/backoff seletivo (só erros retriáveis: 429/5xx/timeout/conexão)

Segurança de fundação: a API key NUNCA é logada nem entra em mensagem de exceção;
o conteúdo das mensagens (PII) NUNCA é logado. Só metadados (modelo, status,
generation_id, contagem de tokens) aparecem em log.
"""

from __future__ import annotations

import asyncio
import json
import random
from collections.abc import AsyncIterator, Awaitable
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.logging import get_logger

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
from .types import ChatResult, StreamDelta, ToolCall, Usage

logger = get_logger()

_BASE_URL = "https://openrouter.ai/api/v1"
# OpenRouter recomenda esses headers de atribuição; aparecem na analytics deles.
_REFERER = "https://highermind.app"
_TITLE = "Highermind v2"

# Defaults de resiliência. Conservadores: o objetivo é absorver blips transitórios
# (429/503), não mascarar falha permanente. Auth/model errors não passam por aqui.
_DEFAULT_TIMEOUT = 120.0
_DEFAULT_MAX_RETRIES = 2
_BACKOFF_BASE = 0.5
_BACKOFF_CAP = 8.0


def _redact_messages(messages: list[dict[str, Any]]) -> str:
    """Resumo seguro de mensagens para log: SÓ contagem e papéis, jamais conteúdo."""
    roles = [str(m.get("role", "?")) for m in messages]
    return f"{len(messages)} msgs ({','.join(roles)})"


class OpenRouterProvider:
    """Provider OpenRouter. Stateless por requisição; reusa um `httpx.AsyncClient`.

    Instancie uma vez por processo (o `ProviderRegistry` de F2-S13 faz isso) e
    chame `chat()`. Lembre de `await provider.aclose()` no shutdown — ou use o
    provider como context manager assíncrono.
    """

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        client: httpx.AsyncClient | None = None,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._settings = settings or get_settings()
        self._max_retries = max(0, max_retries)
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=_BASE_URL,
            timeout=timeout,
        )

    # ------------------------------------------------------------------ lifecycle
    async def aclose(self) -> None:
        """Fecha o `httpx.AsyncClient` se este provider o criou."""
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> OpenRouterProvider:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    # -------------------------------------------------------------------- headers
    def _headers(self, *, stream: bool) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._settings.openrouter_api_key}",
            "HTTP-Referer": _REFERER,
            "X-Title": _TITLE,
            "Content-Type": "application/json",
        }
        if stream:
            headers["Accept"] = "text/event-stream"
        return headers

    @staticmethod
    def _body(
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        stream: bool,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream}
        if tools:
            body["tools"] = tools
        if stream:
            # Pede o bloco de usage no chunk final (OpenRouter respeita esse flag).
            body["stream_options"] = {"include_usage": True}
        # params do agente (temperature, max_tokens, top_p, provider preference...).
        for key, value in params.items():
            if value is not None:
                body[key] = value
        return body

    # ----------------------------------------------------------------- public API
    def chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **params: Any,
    ) -> Awaitable[ChatResult] | AsyncIterator[StreamDelta]:
        """Faz uma chat completion no OpenRouter.

        - `stream=False` -> retorna um awaitable de `ChatResult` (`await chat(...)`).
        - `stream=True`  -> retorna um async generator de `StreamDelta`
          (`async for d in chat(..., stream=True)`).

        Não é `async def` de propósito: o caller decide entre `await` (não-stream)
        e `async for` (stream) sem precisar de um `await` extra no caminho stream.

        `messages` e `tools` já vêm no formato OpenAI (o caller serializa
        `ChatMessage` -> dict e a tool -> openai schema). `params` extra
        (temperature, max_tokens, top_p, provider...) entram direto no body.

        Levanta subclasses de `OpenRouterError` em falha.
        """
        body = self._body(
            model=model, messages=messages, tools=tools, stream=stream, params=params
        )
        if stream:
            return self._stream(body)
        return self._complete(body)

    def chat_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **params: Any,
    ) -> Awaitable[dict[str, Any]] | AsyncIterator[StreamDelta]:
        """Variante que devolve o JSON CRU do OpenRouter no caso não-stream.

        Espelha a assinatura do exemplo de `AGENTS_LANGGRAPH.md §5` / §11 (o
        `call_model_node` referencia `resp["id"]`, `resp["usage"]`,
        `resp["choices"][0]`, `resp["provider"]`). Prefira `chat()` (normalizado)
        em código novo; isto existe para o caller que quer o dict cru.

        - `stream=False` -> awaitable do dict cru.
        - `stream=True`  -> async generator de `StreamDelta` (igual a `chat`).
        """
        body = self._body(
            model=model, messages=messages, tools=tools, stream=stream, params=params
        )
        if stream:
            return self._stream(body)
        return self._request_json(body)

    async def get_generation(self, generation_id: str) -> dict[str, Any]:
        """Busca custo/tokens reais de uma geração (auditoria precisa, F2-S13).

        O OpenRouter expõe o custo real só após o billing settling (~30-60s); o
        job assíncrono de cost reconciliation chama isto para corrigir
        `llm_usage_logs.cost_usd`.
        """
        try:
            resp = await self._client.get(
                "/generation",
                params={"id": generation_id},
                headers=self._headers(stream=False),
            )
        except httpx.TimeoutException as exc:
            raise OpenRouterTimeoutError("timeout em GET /generation") from exc
        except httpx.HTTPError as exc:
            raise OpenRouterConnectionError("falha de conexão em GET /generation") from exc
        self._raise_for_status(resp)
        return self._json(resp)

    # -------------------------------------------------------------- non-stream impl
    async def _complete(self, body: dict[str, Any]) -> ChatResult:
        raw = await self._request_json(body)
        return self._parse_completion(raw)

    async def _request_json(self, body: dict[str, Any]) -> dict[str, Any]:
        """POST /chat/completions com retry seletivo; devolve o JSON cru."""
        resp = await self._post_with_retry(body, stream=False)
        return self._json(resp)

    # ------------------------------------------------------------------ stream impl
    async def _stream(self, body: dict[str, Any]) -> AsyncIterator[StreamDelta]:
        """Consome o SSE do OpenRouter e emite `StreamDelta` por evento útil.

        Retry só vale para o *handshake* (status inicial). Uma vez que o corpo SSE
        começou a fluir não há como retomar com segurança — falha no meio do
        stream vira exceção tipada, e o grafo decide o que fazer.
        """
        attempt = 0
        while True:
            try:
                async for delta in self._open_stream(body):
                    yield delta
                return
            except OpenRouterError as exc:
                # Só pode chegar aqui se a falha foi no handshake (antes do 1º chunk).
                if not exc.retriable or attempt >= self._max_retries:
                    raise
                await self._sleep_backoff(attempt, getattr(exc, "retry_after", None))
                attempt += 1

    async def _open_stream(self, body: dict[str, Any]) -> AsyncIterator[StreamDelta]:
        try:
            async with self._client.stream(
                "POST",
                "/chat/completions",
                json=body,
                headers=self._headers(stream=True),
            ) as resp:
                if resp.status_code >= 400:
                    # Lê o corpo (pequeno) só para classificar o erro; não loga conteúdo.
                    await resp.aread()
                    self._raise_for_status(resp)
                logger.debug(
                    "openrouter stream aberto",
                    model=str(body.get("model")),
                    msgs=_redact_messages(body.get("messages", [])),
                )
                async for line in resp.aiter_lines():
                    delta = self._parse_sse_line(line)
                    if delta is not None:
                        yield delta
        except httpx.TimeoutException as exc:
            raise OpenRouterTimeoutError("timeout no stream do OpenRouter") from exc
        except httpx.HTTPError as exc:
            raise OpenRouterConnectionError("falha de conexão no stream") from exc

    def _parse_sse_line(self, line: str) -> StreamDelta | None:
        """Parseia uma linha SSE (`data: {...}` ou `data: [DONE]`)."""
        line = line.strip()
        if not line or line.startswith(":"):
            # Comentário keep-alive (OpenRouter manda `: OPENROUTER PROCESSING`).
            return None
        if not line.startswith("data:"):
            return None
        payload = line[len("data:") :].strip()
        if payload == "[DONE]":
            return None
        try:
            chunk = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise OpenRouterResponseError("chunk SSE não é JSON válido") from exc
        return self._parse_stream_chunk(chunk)

    @staticmethod
    def _parse_stream_chunk(chunk: dict[str, Any]) -> StreamDelta | None:
        generation_id = chunk.get("id")
        provider = chunk.get("provider")
        usage_raw = chunk.get("usage")
        usage = Usage.from_raw(usage_raw) if usage_raw else None

        choices = chunk.get("choices") or []
        if not choices:
            # Chunk só de usage/keepalive (último frame com include_usage).
            if usage is None:
                return None
            return StreamDelta(
                usage=usage,
                generation_id=generation_id,
                upstream_provider=provider,
            )

        choice = choices[0]
        delta = choice.get("delta") or {}
        content = delta.get("content")
        finish_reason = choice.get("finish_reason")

        tool_call: ToolCall | None = None
        raw_tcs = delta.get("tool_calls")
        if raw_tcs:
            first = raw_tcs[0]
            fn = first.get("function") or {}
            tool_call = ToolCall(
                id=first.get("id") or "",
                name=fn.get("name") or "",
                arguments=fn.get("arguments") or "",
                index=int(first.get("index", 0) or 0),
            )

        if content is None and tool_call is None and finish_reason is None and usage is None:
            return None

        return StreamDelta(
            content=content,
            tool_call=tool_call,
            finish_reason=finish_reason,
            generation_id=generation_id,
            upstream_provider=provider,
            usage=usage,
        )

    # ------------------------------------------------------------------ completion parse
    @staticmethod
    def _parse_completion(raw: dict[str, Any]) -> ChatResult:
        choices = raw.get("choices")
        if not choices:
            raise OpenRouterResponseError("resposta do OpenRouter sem `choices`")
        choice = choices[0]
        message = choice.get("message") or {}

        tool_calls: list[ToolCall] = []
        for idx, tc in enumerate(message.get("tool_calls") or []):
            fn = tc.get("function") or {}
            tool_calls.append(
                ToolCall(
                    id=tc.get("id") or f"call_{idx}",
                    name=fn.get("name") or "",
                    arguments=fn.get("arguments") or "",
                    index=int(tc.get("index", idx) or idx),
                )
            )

        return ChatResult(
            content=message.get("content"),
            tool_calls=tool_calls,
            finish_reason=choice.get("finish_reason"),
            usage=Usage.from_raw(raw.get("usage")),
            generation_id=raw.get("id"),
            upstream_provider=raw.get("provider"),
            model=raw.get("model"),
        )

    # ------------------------------------------------------------------- HTTP + retry
    async def _post_with_retry(self, body: dict[str, Any], *, stream: bool) -> httpx.Response:
        attempt = 0
        while True:
            try:
                resp = await self._client.post(
                    "/chat/completions",
                    json=body,
                    headers=self._headers(stream=stream),
                )
            except httpx.TimeoutException as exc:
                err: OpenRouterError = OpenRouterTimeoutError("timeout no POST /chat/completions")
                if attempt >= self._max_retries:
                    raise err from exc
                await self._sleep_backoff(attempt, None)
                attempt += 1
                continue
            except httpx.HTTPError as exc:
                err = OpenRouterConnectionError("falha de conexão no POST /chat/completions")
                if attempt >= self._max_retries:
                    raise err from exc
                await self._sleep_backoff(attempt, None)
                attempt += 1
                continue

            if resp.status_code < 400:
                return resp

            # Status de erro: classifica. Retria só os retriáveis e com tentativa restante.
            try:
                self._raise_for_status(resp)
            except OpenRouterError as exc:
                if not exc.retriable or attempt >= self._max_retries:
                    raise
                await self._sleep_backoff(attempt, getattr(exc, "retry_after", None))
                attempt += 1
                continue

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        """Mapeia status HTTP do OpenRouter em exceção tipada. Sem PII na mensagem."""
        status = resp.status_code
        if status < 400:
            return

        reason = OpenRouterProvider._error_reason(resp)
        detail = f"OpenRouter {status}: {reason}"

        if status in (401, 403):
            raise OpenRouterAuthError(detail, status_code=status)
        if status == 429:
            raise OpenRouterRateLimitError(
                detail,
                status_code=status,
                retry_after=OpenRouterProvider._retry_after(resp),
            )
        if status in (400, 404, 422):
            # 400/404/422 tipicamente = modelo inválido/indisponível ou request ruim.
            raise OpenRouterModelError(detail, status_code=status)
        if status >= 500:
            raise OpenRouterUpstreamError(detail, status_code=status, retriable=True)
        raise OpenRouterError(detail, status_code=status, retriable=False)

    @staticmethod
    def _error_reason(resp: httpx.Response) -> str:
        """Extrai uma razão curta do corpo de erro — NUNCA o corpo inteiro/PII."""
        try:
            data = resp.json()
        except (json.JSONDecodeError, ValueError):
            return resp.reason_phrase or "erro desconhecido"
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            msg = err.get("message") or err.get("code") or "erro upstream"
            return str(msg)[:200]
        if isinstance(err, str):
            return err[:200]
        return resp.reason_phrase or "erro upstream"

    @staticmethod
    def _retry_after(resp: httpx.Response) -> float | None:
        raw = resp.headers.get("retry-after")
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None

    @staticmethod
    def _json(resp: httpx.Response) -> dict[str, Any]:
        try:
            data = resp.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise OpenRouterResponseError("resposta do OpenRouter não é JSON") from exc
        if not isinstance(data, dict):
            raise OpenRouterResponseError("resposta do OpenRouter não é um objeto JSON")
        return data

    async def _sleep_backoff(self, attempt: int, retry_after: float | None) -> None:
        """Backoff exponencial com jitter; respeita `Retry-After` quando presente."""
        if retry_after is not None and retry_after > 0:
            delay = min(retry_after, _BACKOFF_CAP)
        else:
            delay = min(_BACKOFF_BASE * (2**attempt), _BACKOFF_CAP)
            delay += random.uniform(0, _BACKOFF_BASE)  # noqa: S311 - jitter, não cripto
        logger.warning("openrouter retry", attempt=attempt + 1, delay_s=round(delay, 2))
        await asyncio.sleep(delay)
