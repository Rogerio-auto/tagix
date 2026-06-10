"""Exceções tipadas do provider OpenRouter.

Mapear o universo de falhas upstream (rate limit, modelo indisponível, erro do
provider real, auth) em tipos próprios é fundação: o grafo (F2-S05) decide
política de retry/handoff/emissão de evento (`model_blocked`, `budget_exceeded`)
olhando o *tipo* da exceção, nunca fazendo string-match em mensagem crua.

Hierarquia:

    OpenRouterError                      (base — tudo abaixo é capturável por ela)
    ├── OpenRouterAuthError              401/403 — chave inválida. NÃO retriável.
    ├── OpenRouterRateLimitError         429 — retriável com backoff (Retry-After).
    ├── OpenRouterModelError             400/404 de modelo — modelo inválido/indisponível.
    ├── OpenRouterUpstreamError          502/503 do provider real por trás do roteador.
    ├── OpenRouterTimeoutError           timeout de rede/leitura. Retriável.
    ├── OpenRouterConnectionError        falha de conexão. Retriável.
    └── OpenRouterResponseError          payload malformado / SSE corrompido.

Nenhuma mensagem carrega corpo de resposta com PII; só status + razão curta.
"""

from __future__ import annotations


class OpenRouterError(Exception):
    """Base de toda falha do provider OpenRouter.

    `status_code` é o HTTP status quando aplicável (None para falhas de rede).
    `retriable` indica se faz sentido tentar de novo com backoff — o chamador
    (grafo) confia nesse flag, não reinterpreta o status.
    """

    status_code: int | None = None
    retriable: bool = False

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retriable: bool | None = None,
    ) -> None:
        super().__init__(message)
        if status_code is not None:
            self.status_code = status_code
        if retriable is not None:
            self.retriable = retriable


class OpenRouterAuthError(OpenRouterError):
    """401/403 — chave/credencial inválida. Falha permanente; nunca retriar."""

    retriable = False


class OpenRouterRateLimitError(OpenRouterError):
    """429 — rate limit do OpenRouter ou do provider real. Retriável com backoff.

    `retry_after` (segundos) vem do header `Retry-After` quando presente; o
    cliente o respeita antes do backoff exponencial.
    """

    retriable = True

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = 429,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message, status_code=status_code, retriable=True)
        self.retry_after = retry_after


class OpenRouterModelError(OpenRouterError):
    """Modelo inválido/indisponível (tipicamente 400/404). NÃO retriável.

    Vira evento `model_blocked` no stream do grafo.
    """

    retriable = False


class OpenRouterUpstreamError(OpenRouterError):
    """Falha do provider real por trás do roteador (5xx). Retriável."""

    retriable = True


class OpenRouterTimeoutError(OpenRouterError):
    """Timeout de conexão/leitura. Retriável."""

    retriable = True


class OpenRouterConnectionError(OpenRouterError):
    """Falha de conexão de rede (DNS/recusada). Retriável."""

    retriable = True


class OpenRouterResponseError(OpenRouterError):
    """Resposta malformada: JSON inválido, SSE corrompido, campos faltando.

    NÃO retriável por default (um retry tende a repetir o mesmo payload ruim).
    """

    retriable = False
