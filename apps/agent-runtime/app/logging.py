"""Logging estruturado (loguru) com redação de PII.

Padrão world-class, inegociável: telefone, e-mail, Bearer/API tokens e o token
interno do runtime NUNCA podem aparecer em claro nos logs. A redação acontece no
sink (não confiamos no call-site lembrar de mascarar) — é defesa de fundação.

`configure_logging()` é idempotente e deve ser chamado uma vez no startup.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Final

from loguru import logger

# ----------------------------------------------------------------------------
# Padrões de PII. Ordem importa: tokens longos antes de e-mail/telefone para não
# fatiar um Bearer no meio. Todos com âncoras de fronteira para evitar matches
# espúrios em ids/uuids legítimos.
# ----------------------------------------------------------------------------

_EMAIL_RE: Final = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
)

# E.164 e variações com separadores comuns (mín. 8 dígitos para não pegar ids curtos).
_PHONE_RE: Final = re.compile(
    r"(?<![\w.])\+?\d[\d\s().\-]{7,}\d(?![\w.])",
)

# `Authorization: Bearer xxx`, `api_key=xxx`, `"token": "xxx"`, `sk-...`, `Bearer xxx`.
_BEARER_RE: Final = re.compile(
    r"(?i)\bBearer\s+[A-Za-z0-9._\-]+",
)
# Chave/valor de segredo. Aceita separadores `=`/`:` com aspas opcionais de ambos
# os lados (cobre JSON `"api_key": "xxx"` e KV `api_key=xxx`). O valor é capturado
# de forma greedy até a aspa/fim, então mascarado por inteiro.
_SECRET_KV_RE: Final = re.compile(
    r"(?i)(?P<key>api[_-]?key|token|secret|password|authorization)"
    r"(?P<sep>[\"']?\s*[=:]\s*[\"']?)"
    r"(?P<val>[A-Za-z0-9._\-]{4,})",
)
# Chaves no estilo provider: sk-..., sk-or-v1-..., key-..., rk-... (com hifens internos).
_PROVIDER_KEY_RE: Final = re.compile(
    r"(?i)\b(?:sk|rk|key)(?:-[A-Za-z0-9]+)*-[A-Za-z0-9]{6,}",
)

_MASK: Final = "[REDACTED]"


def redact_pii(text: str) -> str:
    """Mascara PII e segredos numa string. Idempotente e seguro para `[REDACTED]`."""
    if not text:
        return text
    # Segredos primeiro (mais específicos), depois e-mail, depois telefone.
    text = _BEARER_RE.sub(f"Bearer {_MASK}", text)
    text = _PROVIDER_KEY_RE.sub(_MASK, text)
    text = _SECRET_KV_RE.sub(lambda m: f"{m.group('key')}{m.group('sep')}{_MASK}", text)
    text = _EMAIL_RE.sub(_MASK, text)
    text = _PHONE_RE.sub(_MASK, text)
    return text


def _redacting_patcher(record: "dict") -> None:  # noqa: UP037 - loguru record dict
    """Patcher loguru: redige a mensagem já formatada e os valores de `extra`."""
    record["message"] = redact_pii(record["message"])
    extra = record.get("extra")
    if extra:
        record["extra"] = {
            key: redact_pii(value) if isinstance(value, str) else value
            for key, value in extra.items()
        }


class _InterceptHandler(logging.Handler):
    """Redireciona o stdlib `logging` (uvicorn, asyncpg) para o sink loguru."""

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - glue
        try:
            level: str | int = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1
        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


_CONFIGURED = False


def configure_logging(*, level: str = "INFO", json_logs: bool = True) -> None:
    """Configura o sink loguru com redação de PII. Idempotente."""
    global _CONFIGURED

    logger.remove()
    logger.configure(patcher=_redacting_patcher)
    logger.add(
        sys.stderr,
        level=level.upper(),
        serialize=json_logs,
        backtrace=False,  # nunca despejar variáveis locais (podem conter PII)
        diagnose=False,
        enqueue=True,
    )

    # Captura logs do stdlib (uvicorn/asyncpg) no mesmo pipeline redigido.
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "asyncpg", "fastapi"):
        std = logging.getLogger(name)
        std.handlers = [_InterceptHandler()]
        std.propagate = False

    _CONFIGURED = True


def get_logger():
    """Devolve o logger loguru (configurado no startup)."""
    return logger
