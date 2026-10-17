"""Bearer de serviço (`AGENT_RUNTIME_TOKEN`) das rotas do Copiloto e do `/kb/search`.

Mesmo esquema do `/run` (`Authorization: Bearer <token>`), com comparação em tempo
constante (`hmac.compare_digest`): o Node faz o mesmo do lado dele (ADR-003 §3.1).
A resposta de falha é estável e não diz o que estava errado.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Header, HTTPException, status

from app.config import get_settings

_PREFIX = "Bearer "


def verify_runtime_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().agent_runtime_token
    provided = (
        authorization[len(_PREFIX) :] if authorization and authorization.startswith(_PREFIX) else ""
    )
    if not provided or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing runtime token",
        )
