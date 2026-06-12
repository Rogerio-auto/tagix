"""Observabilidade do agent-runtime (server-side).

Reúne, num único módulo opt-in:
  - `init_sentry()` — captura de exceções via Sentry (no-op sem `SENTRY_DSN_AGENT_RUNTIME`);
  - `MetricsMiddleware` + `metrics_router` — métricas Prometheus (RED HTTP + domínio LLM)
    expostas em `GET /metrics`.

Tudo segue o padrão da casa: nada liga sem env (Sentry), e as métricas são
in-process e baratas (prometheus_client). O wire em `main.py` é do orchestrator.
"""

from __future__ import annotations

from app.observability.metrics import (
    MetricsMiddleware,
    metrics_router,
    record_llm_call,
    record_run,
)
from app.observability.sentry import init_sentry, is_sentry_enabled

__all__ = [
    "MetricsMiddleware",
    "metrics_router",
    "record_llm_call",
    "record_run",
    "init_sentry",
    "is_sentry_enabled",
]
