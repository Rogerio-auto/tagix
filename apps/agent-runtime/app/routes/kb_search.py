"""`POST /kb/search`: busca na base de conhecimento, chamada pelo **Node** (F73-S04).

> **source:** `COPILOTO.md` §5.4 ("KB") e §11.6.

A busca só existia dentro do runtime (`_kb_retrieval.py`, usada pela ferramenta dos
agentes). O Copiloto não acessa o banco pelo grafo (ADR-003 §6): quem chama esta rota
é o Node, que já decidiu workspace e permissão do membro, e devolve o resultado ao
modelo pelo callback de ferramenta.

- Auth: bearer de serviço (`AGENT_RUNTIME_TOKEN`), comparação em tempo constante.
- Body (fechado): `{ workspace_id: uuid, query: 1..500, limit: 1..8 = 5 }`.
- 200: `{ results: { document_id, title, snippet (≤ 600), score }[] }`, um por
  documento (o melhor trecho), em ordem de score.
- 502 se o embedding falhar; 503 se o banco estiver indisponível.

Reusa `_kb_retrieval.retrieve` **por import**, sem mudar o comportamento: a busca roda
sob `with_workspace` (RLS) e herda os filtros dele (`status='active'` e
`visible_to_agents=true`).
"""

from __future__ import annotations

from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.copilot.auth import verify_runtime_token
from app.copilot.types import Uuid
from app.db import get_pool
from app.logging import get_logger
from app.providers.embeddings import EmbeddingsError, EmbeddingsProvider
from app.tools.database import _kb_retrieval

logger = get_logger()

router = APIRouter(tags=["knowledge"])

SNIPPET_MAX_CHARS: Final = 600
# Vários trechos podem ser do mesmo documento: pede mais e deduplica por documento.
_OVERFETCH: Final = 3
_MAX_CHUNKS: Final = 24


class KbSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    workspace_id: Uuid
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=8)


class KbSearchResult(BaseModel):
    document_id: str
    title: str
    snippet: str = Field(max_length=SNIPPET_MAX_CHARS)
    score: float


class KbSearchResponse(BaseModel):
    results: list[KbSearchResult]


def make_snippet(content: str) -> str:
    """Trecho em uma linha, ≤ 600 caracteres, cortado em fronteira de palavra."""
    flat = " ".join(content.split())
    if len(flat) <= SNIPPET_MAX_CHARS:
        return flat
    cut = flat[: SNIPPET_MAX_CHARS - 1]
    space = cut.rfind(" ")
    if space > SNIPPET_MAX_CHARS // 2:
        cut = cut[:space]
    return cut.rstrip() + "…"


def get_kb_pool() -> Any:
    """Pool asyncpg global (seam de teste via `dependency_overrides`)."""
    return get_pool()


def get_embeddings_provider(request: Request) -> EmbeddingsProvider:
    """Provider publicado no lifespan; um efêmero em fallback."""
    provider = getattr(request.app.state, "embeddings_provider", None)
    return provider if provider is not None else EmbeddingsProvider()


@router.post("/kb/search", response_model=KbSearchResponse)
async def kb_search(
    req: KbSearchRequest,
    _: Annotated[None, Depends(verify_runtime_token)],
    pool: Annotated[Any, Depends(get_kb_pool)],
    provider: Annotated[EmbeddingsProvider, Depends(get_embeddings_provider)],
) -> KbSearchResponse:
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="empty query")

    try:
        embedded = await provider.embed([query])
    except EmbeddingsError as exc:
        logger.warning("kb/search: falha no embedding", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="embeddings upstream unavailable"
        ) from exc

    try:
        chunks = await _kb_retrieval.retrieve(
            pool,
            workspace_id=req.workspace_id,
            query_embedding=embedded.embeddings[0],
            query_text=query,
            k=min(req.limit * _OVERFETCH, _MAX_CHUNKS),
        )
    except Exception as exc:  # noqa: BLE001 - banco indisponível vira 503 estável
        logger.error("kb/search: falha no retrieval", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="knowledge base unavailable"
        ) from exc

    best: dict[str, KbSearchResult] = {}
    for chunk in chunks:  # já em ordem de score decrescente
        if chunk.document_id in best:
            continue
        best[chunk.document_id] = KbSearchResult(
            document_id=chunk.document_id,
            title=chunk.title,
            snippet=make_snippet(chunk.content),
            score=chunk.score,
        )
        if len(best) >= req.limit:
            break
    return KbSearchResponse(results=list(best.values()))
