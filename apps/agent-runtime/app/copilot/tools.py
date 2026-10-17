"""Ferramentas do Copiloto: callback HTTP ao Node com o grant do turno.

> **source:** `COPILOTO.md` §5.4 · ADR-003 §2–§3.

Toda ferramenta do Copiloto (consulta ou `propose_*`) roda no Node:

    POST {API_BASE_URL}/internal/copilot/tools/{key}
    Authorization: Bearer AGENT_RUNTIME_TOKEN
    X-Copilot-Grant: <grant opaco do turno>
    { "turn_id", "call_id", "args" }

O Node reautoriza do zero a cada chamada (bearer, HMAC do grant, turno vivo, membro
recarregado, capacidade) e devolve o `CopilotToolEnvelope` `{ ok, decision,
result_id?, model_view, public_event? }`.

Disciplina (a mesma de `app/tools/callback.py`, que fica intocado):
- token e grant nunca entram em log, em mensagem de erro, no `model_view` nem no
  evento; o log leva só `tool_key`, status HTTP e duração;
- erro HTTP, timeout, resposta não-JSON ou fora do contrato viram um envelope
  sintético com `model_view` seguro e estável. O corpo cru do Node nunca chega ao
  modelo;
- timeout de 20 s por chamada; sem redirect (padrão do httpx).
"""

from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Any, Final

import httpx

from app.config import Settings
from app.copilot.types import CopilotToolDescriptor
from app.logging import get_logger

logger = get_logger()

CALLBACK_TIMEOUT_S: Final = 20.0
# Resposta maior que isso não é um envelope legítimo (o Node limita o resultado a 24 KB).
_MAX_RESPONSE_BYTES: Final = 256 * 1024

SAFE_FAILURE_VIEW: Final = (
    "A ferramenta falhou e não devolveu dados. Diga isso à pessoa e não invente o resultado."
)
SAFE_INVALID_ARGS_VIEW: Final = (
    "Os argumentos não eram um JSON válido; nada foi executado. Corrija e tente de novo."
)
SAFE_UNKNOWN_TOOL_VIEW: Final = (
    "Esta ferramenta não existe para esta pessoa; nada foi executado. Use só as oferecidas."
)
SAFE_LIMIT_VIEW: Final = (
    "Limite de chamadas de ferramenta deste pedido atingido; nada foi executado. "
    "Responda com o que já tem, chamando answer."
)
SAFE_STOPPED_VIEW: Final = (
    "Não executado: o pedido parou depois de uma proposta ou bloqueio. Chame answer."
)


def failure_envelope(model_view: str = SAFE_FAILURE_VIEW) -> dict[str, Any]:
    """Envelope sintético de falha (nunca carrega corpo do Node)."""
    return {"ok": False, "decision": "error", "model_view": model_view}


def _is_envelope(data: Any) -> bool:
    return (
        isinstance(data, dict)
        and isinstance(data.get("ok"), bool)
        and isinstance(data.get("decision"), str)
        and "model_view" in data
        and (data.get("result_id") is None or isinstance(data.get("result_id"), str))
    )


@dataclass(frozen=True, slots=True)
class CallbackOutcome:
    envelope: dict[str, Any]
    # `False` quando o envelope é sintético (falha de transporte ou contrato).
    from_node: bool
    duration_ms: int


class CopilotCallbackTool:
    """Uma ferramenta oferecida ao modelo, executada no Node por callback."""

    def __init__(
        self,
        descriptor: CopilotToolDescriptor,
        *,
        http_client: httpx.AsyncClient,
        settings: Settings,
        timeout_s: float = CALLBACK_TIMEOUT_S,
    ) -> None:
        self.descriptor = descriptor
        self._client = http_client
        self._settings = settings
        self._timeout = timeout_s

    @property
    def key(self) -> str:
        return self.descriptor.key

    def openai_spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.descriptor.key,
                "description": self.descriptor.description,
                "parameters": self.descriptor.parameters,
            },
        }

    @property
    def _url(self) -> str:
        base = self._settings.api_base_url.rstrip("/")
        return f"{base}/internal/copilot/tools/{self.descriptor.key}"

    async def call(
        self,
        *,
        turn_id: str,
        grant: str,
        call_id: str,
        args: dict[str, Any],
    ) -> CallbackOutcome:
        """Executa o callback. Nunca levanta exceção de transporte: devolve envelope."""
        headers = {
            "Authorization": f"Bearer {self._settings.agent_runtime_token}",
            "X-Copilot-Grant": grant,
            "Content-Type": "application/json",
        }
        started = monotonic()
        try:
            resp = await self._client.post(
                self._url,
                headers=headers,
                json={"turn_id": turn_id, "call_id": call_id, "args": args},
                timeout=self._timeout,
            )
        except httpx.TimeoutException:
            return self._fail(started, reason="timeout")
        except httpx.HTTPError:
            return self._fail(started, reason="transport")

        if resp.status_code >= 400:
            return self._fail(started, reason="http", status=resp.status_code)
        if len(resp.content) > _MAX_RESPONSE_BYTES:
            return self._fail(started, reason="too_large", status=resp.status_code)
        try:
            data = resp.json()
        except ValueError:
            return self._fail(started, reason="not_json", status=resp.status_code)
        if not _is_envelope(data):
            return self._fail(started, reason="bad_envelope", status=resp.status_code)

        duration_ms = round((monotonic() - started) * 1000)
        logger.info(
            "copilot tool ok",
            tool_key=self.key,
            decision=str(data["decision"]),
            duration_ms=duration_ms,
        )
        return CallbackOutcome(envelope=data, from_node=True, duration_ms=duration_ms)

    def _fail(self, started: float, *, reason: str, status: int | None = None) -> CallbackOutcome:
        duration_ms = round((monotonic() - started) * 1000)
        logger.warning(
            "copilot tool falhou",
            tool_key=self.key,
            reason=reason,
            status=status,
            duration_ms=duration_ms,
        )
        return CallbackOutcome(
            envelope=failure_envelope(), from_node=False, duration_ms=duration_ms
        )


def build_callback_tools(
    descriptors: list[CopilotToolDescriptor],
    *,
    http_client: httpx.AsyncClient,
    settings: Settings,
) -> dict[str, CopilotCallbackTool]:
    """Ferramentas do turno, construídas dos descritores do request (ordem preservada)."""
    return {
        d.key: CopilotCallbackTool(d, http_client=http_client, settings=settings)
        for d in descriptors
    }
