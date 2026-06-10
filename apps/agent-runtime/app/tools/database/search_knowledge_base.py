"""Tool `search_knowledge_base` — RAG real sobre a base de conhecimento (§7.3, §12.2).

> **Slot:** F3-S05 (substitui o stub de F2-S06).

Retrieval híbrido sob RLS de workspace:
  1. embed da query via `EmbeddingsProvider` (OpenAI direto — F3-S02, in-process);
  2. busca vetorial cosine (HNSW) + FTS pt + re-rank por priority/feedback
     (`_kb_retrieval.retrieve`), só docs `active` + `visible_to_agents`;
  3. devolve trechos com citações (`document_id`, `chunk_id`, título, score).

Categoria `knowledge` (não `database`): não é SELECT de coluna comum (sem ACL de
coluna), então continua `Tool` puro — não subclassifica `DatabaseTool`.

Injeção: o pool asyncpg e o `EmbeddingsProvider` são opcionais no construtor; se
omitidos (caminho atual do `build_light_db_tools`), são resolvidos lazy em `_run`
via `app.db.get_pool()` e um `EmbeddingsProvider()` próprio. Isso mantém a
assinatura `SearchKnowledgeBaseTool()` compatível sem tocar o registry.
"""

from __future__ import annotations

import asyncpg
from pydantic import BaseModel, Field

from app.logging import get_logger
from app.providers.embeddings import EmbeddingsError, EmbeddingsProvider
from app.tools.base import Tool, ToolContext, ToolResult
from app.tools.database._kb_retrieval import RetrievedChunk, retrieve

logger = get_logger()

# Quantos caracteres de cada trecho expor no `content` textual ao modelo.
_SNIPPET_CHARS = 600


class SearchKnowledgeBaseArgs(BaseModel):
    query: str = Field(description="Pergunta/consulta em linguagem natural.")
    k: int = Field(default=5, ge=1, le=20, description="Quantos trechos retornar.")


class SearchKnowledgeBaseTool(Tool):
    key = "search_knowledge_base"
    name = "Buscar na base de conhecimento"
    description = (
        "Busca trechos relevantes na base de conhecimento do workspace (RAG). "
        "Use antes de responder sobre produtos/políticas."
    )
    category = "knowledge"
    table = None
    Args = SearchKnowledgeBaseArgs

    def __init__(
        self,
        pool: asyncpg.Pool | None = None,
        *,
        embeddings_provider: EmbeddingsProvider | None = None,
        handler_config: dict | None = None,
    ) -> None:
        super().__init__(handler_config)
        self._pool = pool
        self._provider = embeddings_provider

    def _get_pool(self) -> asyncpg.Pool:
        if self._pool is not None:
            return self._pool
        from app.db import get_pool

        return get_pool()

    def _get_provider(self) -> EmbeddingsProvider:
        if self._provider is None:
            self._provider = EmbeddingsProvider()
        return self._provider

    async def _run(self, args: SearchKnowledgeBaseArgs, ctx: ToolContext) -> ToolResult:
        if ctx.is_playground:
            return ToolResult(
                ok=True,
                content="(simulado) Busca na base de conhecimento.",
                payload={"results": [], "indexed": True, "simulated": True},
            )

        # 1) embed da query (custo registrado em llm_usage_logs via /internal/embed
        #    quando chamado pelo worker; aqui é in-process e o uso é contabilizado
        #    no fluxo de ingestão. O retrieval em si não grava usage por chamada).
        try:
            embedded = await self._get_provider().embed([args.query])
        except EmbeddingsError:
            logger.warning("search_knowledge_base: falha ao embedar a query")
            return ToolResult(
                ok=False,
                error="Não foi possível consultar a base de conhecimento agora.",
            )

        if not embedded.embeddings:
            return ToolResult(
                ok=True,
                content="Nenhum trecho encontrado.",
                payload={"results": [], "indexed": True},
            )

        # 2) retrieval híbrido sob RLS.
        chunks = await retrieve(
            self._get_pool(),
            workspace_id=ctx.workspace_id,
            query_embedding=embedded.embeddings[0],
            query_text=args.query,
            k=args.k,
        )

        # 3) base vazia -> resultado vazio explícito (não é erro).
        if not chunks:
            return ToolResult(
                ok=True,
                content="Nenhum trecho relevante encontrado na base de conhecimento.",
                payload={"results": [], "indexed": True},
            )

        results = [
            {
                "document_id": c.document_id,
                "chunk_id": c.chunk_id,
                "title": c.title,
                "content": c.content,
                "score": c.score,
            }
            for c in chunks
        ]
        return ToolResult(
            ok=True,
            content=_format_for_model(chunks),
            payload={"results": results, "indexed": True},
        )


def _format_for_model(chunks: list[RetrievedChunk]) -> str:
    """Monta um texto legível com os trechos + fontes para o modelo citar."""
    lines: list[str] = ["Trechos encontrados na base de conhecimento:"]
    for i, c in enumerate(chunks, start=1):
        snippet = c.content.strip().replace("\n", " ")
        if len(snippet) > _SNIPPET_CHARS:
            snippet = snippet[:_SNIPPET_CHARS].rstrip() + "…"
        lines.append(f"[{i}] {c.title}: {snippet}")
    return "\n".join(lines)
