"""Métricas Prometheus do agent-runtime.

Expõe RED HTTP (latência/contagem por rota/status via middleware ASGI) e sinais
de domínio do runtime de IA (runs de agente, chamadas ao LLM, tokens). O
`metrics_router` serve `GET /metrics` no formato de exposição Prometheus,
scrapeado pelo Prometheus do stack de observabilidade.

prometheus_client é in-process e barato; não há opt-in aqui (o pipeline OTLP/
collector é cuidado à parte). O wire (`add_middleware` + `include_router`) é do
orchestrator em `main.py`.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from fastapi import APIRouter, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)
from starlette.requests import Request
from starlette.types import ASGIApp

# Registry dedicado do runtime (rótulo de serviço aplicado por métrica).
REGISTRY = CollectorRegistry()

_HTTP_DURATION = Histogram(
    "http_request_duration_seconds",
    "Duração das requisições HTTP do agent-runtime, por método/rota/status.",
    labelnames=("method", "route", "status"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
    registry=REGISTRY,
)
_HTTP_TOTAL = Counter(
    "http_requests_total",
    "Total de requisições HTTP do agent-runtime, por método/rota/status.",
    labelnames=("method", "route", "status"),
    registry=REGISTRY,
)

# --- Domínio: runs de agente + chamadas ao LLM ---
_AGENT_RUNS = Counter(
    "hm_agent_runtime_runs_total",
    "Runs de agente executados, por resultado.",
    labelnames=("result",),
    registry=REGISTRY,
)
_AGENT_RUN_DURATION = Histogram(
    "hm_agent_runtime_run_duration_seconds",
    "Duração de um run de agente, em segundos.",
    buckets=(0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60),
    registry=REGISTRY,
)
_LLM_CALLS = Counter(
    "hm_agent_runtime_llm_calls_total",
    "Chamadas ao LLM (via OpenRouter), por modelo e resultado.",
    labelnames=("model", "result"),
    registry=REGISTRY,
)
_LLM_TOKENS = Counter(
    "hm_agent_runtime_llm_tokens_total",
    "Tokens consumidos no LLM, por modelo e tipo (prompt/completion).",
    labelnames=("model", "kind"),
    registry=REGISTRY,
)


def _route_label(request: Request) -> str:
    """Rótulo de rota estável: usa o template registrado (`/run/{id}`) e não o
    path concreto, para não explodir a cardinalidade. Fallback `unmatched`."""
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    return "unmatched"


class MetricsMiddleware:
    """Middleware ASGI puro que instrumenta cada request HTTP (RED).

    Implementado no protocolo ASGI (não BaseHTTPMiddleware) para capturar o
    status real sem bufferizar o corpo da resposta — barato e correto.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        # O endpoint de scrape não se auto-instrumenta.
        if request.url.path == "/metrics":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_holder = {"code": 500}

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start":
                status_holder["code"] = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - start
            labels = {
                "method": request.method,
                "route": _route_label(request),
                "status": str(status_holder["code"]),
            }
            _HTTP_DURATION.labels(**labels).observe(elapsed)
            _HTTP_TOTAL.labels(**labels).inc()


def record_run(result: str, duration_seconds: float) -> None:
    """Registra um run de agente concluído (`ok`/`error`) com duração."""
    _AGENT_RUNS.labels(result=result).inc()
    if duration_seconds >= 0:
        _AGENT_RUN_DURATION.observe(duration_seconds)


def record_llm_call(
    model: str,
    result: str,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> None:
    """Registra uma chamada ao LLM e os tokens consumidos."""
    _LLM_CALLS.labels(model=model, result=result).inc()
    if prompt_tokens > 0:
        _LLM_TOKENS.labels(model=model, kind="prompt").inc(prompt_tokens)
    if completion_tokens > 0:
        _LLM_TOKENS.labels(model=model, kind="completion").inc(completion_tokens)


metrics_router = APIRouter(tags=["observability"])


@metrics_router.get("/metrics")
async def metrics() -> Response:
    """Snapshot Prometheus (text exposition format)."""
    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)
