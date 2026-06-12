"""Sentry opt-in para o agent-runtime.

No-op completo sem `SENTRY_DSN_AGENT_RUNTIME`: nenhuma conexão, nenhum overhead,
nenhuma exceção. Mesmo contrato dos apps Node (`@hm/api`/`@hm/workers`).
Idempotente — chamadas repetidas são ignoradas.

`init_sentry()` deve ser chamado uma vez no startup (lifespan), antes de servir
requests. O orchestrator faz o wire em `main.py`.
"""

from __future__ import annotations

import os

from app.logging import get_logger

logger = get_logger()

_initialized = False


def _sample_rate(env_key: str) -> float:
    """Lê uma taxa de amostragem [0,1] de env; default 0 (sem custo)."""
    raw = os.environ.get(env_key)
    if not raw:
        return 0.0
    try:
        value = float(raw)
    except ValueError:
        return 0.0
    return value if 0.0 <= value <= 1.0 else 0.0


def init_sentry() -> bool:
    """Inicializa o Sentry se houver DSN. Idempotente; devolve se está ativo."""
    global _initialized
    if _initialized:
        return True

    dsn = os.environ.get("SENTRY_DSN_AGENT_RUNTIME")
    if not dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("NODE_ENV", "development"),
        release=os.environ.get("HM_RELEASE"),
        traces_sample_rate=_sample_rate("SENTRY_TRACES_SAMPLE_RATE"),
        # Nunca enviar PII por padrão (mensagens de contatos não vazam).
        send_default_pii=False,
    )
    _initialized = True
    logger.info("sentry: agent-runtime capture habilitado")
    return True


def is_sentry_enabled() -> bool:
    """True quando o Sentry foi efetivamente inicializado (DSN presente)."""
    return _initialized
