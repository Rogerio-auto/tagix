"""Provider de embeddings — OpenAI DIRETO (text-embedding-3-small, 1536 dims).

> **Slot:** F3-S02 — DATA_MODEL §8.2/§11; AGENTS_LANGGRAPH §12.2.

Decisão travada (ADR): embeddings vão **direto à OpenAI**, fora do OpenRouter, que
não roteia embeddings. A dimensão 1536 é contrato rígido com a coluna
`kb_chunks.embedding vector(1536)` (F3-S01) — não muda sem migration.

Responsabilidades:
  - `embed(texts) -> EmbeddingResult`: chama `POST /v1/embeddings` via httpx async,
    com batching (limita o tamanho do request) e retry/backoff seletivo (429/5xx/timeout).
  - Captura `usage.total_tokens` e calcula custo em USD (snapshot de pricing).
  - Nunca loga a API key nem o conteúdo dos textos (PII) — só metadados (modelo,
    contagem de itens, tokens).

Consumido:
  - in-process por F3-S05 (`search_knowledge_base`, embedda a query).
  - via HTTP `/internal/embed` (route.py) pelo worker de ingestão Node (F3-S03).
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field

import httpx

from app.config import Settings, get_settings
from app.logging import get_logger

logger = get_logger()

_BASE_URL = "https://api.openai.com/v1"

# Resiliência conservadora: absorve blips transitórios (429/5xx/timeout), não
# mascara falha permanente (auth/400 não passam por retry).
_DEFAULT_TIMEOUT = 30.0
_DEFAULT_MAX_RETRIES = 2
_BACKOFF_BASE = 0.5
_BACKOFF_CAP = 8.0
# OpenAI aceita até 2048 inputs por request; mantemos folga.
_MAX_BATCH = 256

# Pricing snapshot (USD por token) — text-embedding-3-small = $0.02 / 1M tokens.
# Centralizado aqui; troca de modelo deve revisar isto.
_PRICING_PER_TOKEN: dict[str, float] = {
    "text-embedding-3-small": 0.02 / 1_000_000,
    "text-embedding-3-large": 0.13 / 1_000_000,
}


class EmbeddingsError(Exception):
    """Falha ao gerar embeddings (upstream OpenAI indisponível/erro)."""


class EmbeddingsAuthError(EmbeddingsError):
    """API key inválida/ausente (401) — não retriável."""


@dataclass(frozen=True)
class EmbeddingUsage:
    """Uso agregado de uma chamada de embeddings (alimenta `llm_usage_logs`)."""

    total_tokens: int
    total_cost_usd: float


@dataclass
class EmbeddingResult:
    """Resultado de `embed`: vetores na ordem dos textos + uso + modelo."""

    embeddings: list[list[float]] = field(default_factory=list)
    model: str = ""
    usage: EmbeddingUsage = field(default_factory=lambda: EmbeddingUsage(0, 0.0))


def _retriable_status(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code < 600


def _cost_usd(model: str, total_tokens: int) -> float:
    per_token = _PRICING_PER_TOKEN.get(model, _PRICING_PER_TOKEN["text-embedding-3-small"])
    return round(per_token * total_tokens, 10)


class EmbeddingsProvider:
    """Cliente de embeddings da OpenAI. Isola o resto do código do shape cru da API."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        max_retries: int = _DEFAULT_MAX_RETRIES,
    ) -> None:
        self._settings = settings or get_settings()
        self._model = self._settings.embedding_model
        self._dim = self._settings.embedding_dim
        self._max_retries = max_retries
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT)

    @property
    def model(self) -> str:
        return self._model

    @property
    def dimensions(self) -> int:
        return self._dim

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def embed(self, texts: list[str]) -> EmbeddingResult:
        """Gera embeddings para `texts`, preservando a ordem. Batching automático."""
        if not texts:
            return EmbeddingResult(embeddings=[], model=self._model, usage=EmbeddingUsage(0, 0.0))

        all_vectors: list[list[float]] = []
        total_tokens = 0
        for start in range(0, len(texts), _MAX_BATCH):
            batch = texts[start : start + _MAX_BATCH]
            vectors, tokens = await self._embed_batch(batch)
            all_vectors.extend(vectors)
            total_tokens += tokens

        cost = _cost_usd(self._model, total_tokens)
        logger.info(
            "embeddings geradas",
            model=self._model,
            n_inputs=len(texts),
            total_tokens=total_tokens,
        )
        return EmbeddingResult(
            embeddings=all_vectors,
            model=self._model,
            usage=EmbeddingUsage(total_tokens=total_tokens, total_cost_usd=cost),
        )

    async def _embed_batch(self, batch: list[str]) -> tuple[list[list[float]], int]:
        payload = {"model": self._model, "input": batch, "dimensions": self._dim}
        headers = {"Authorization": f"Bearer {self._settings.openai_api_key}"}

        attempt = 0
        while True:
            try:
                resp = await self._client.post(
                    f"{_BASE_URL}/embeddings", json=payload, headers=headers
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt >= self._max_retries:
                    raise EmbeddingsError("falha de conexão com a OpenAI") from exc
                await self._sleep_backoff(attempt)
                attempt += 1
                continue

            if resp.status_code == 401:
                raise EmbeddingsAuthError("OpenAI rejeitou a API key (401)")
            if _retriable_status(resp.status_code):
                if attempt >= self._max_retries:
                    raise EmbeddingsError(f"OpenAI indisponível (status {resp.status_code})")
                await self._sleep_backoff(attempt)
                attempt += 1
                continue
            if resp.status_code >= 400:
                raise EmbeddingsError(f"OpenAI rejeitou o request (status {resp.status_code})")

            return self._parse_response(resp.json())

    def _parse_response(self, body: dict) -> tuple[list[list[float]], int]:
        try:
            data = sorted(body["data"], key=lambda d: d["index"])
            vectors = [item["embedding"] for item in data]
            total_tokens = int(body.get("usage", {}).get("total_tokens", 0))
        except (KeyError, TypeError, ValueError) as exc:
            raise EmbeddingsError("resposta da OpenAI em formato inesperado") from exc

        for v in vectors:
            if len(v) != self._dim:
                raise EmbeddingsError(
                    f"dimensão inesperada: esperado {self._dim}, veio {len(v)}"
                )
        return vectors, total_tokens

    async def _sleep_backoff(self, attempt: int) -> None:
        delay = min(_BACKOFF_CAP, _BACKOFF_BASE * (2**attempt))
        delay += random.uniform(0, delay * 0.25)  # jitter
        await asyncio.sleep(delay)
