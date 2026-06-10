"""Helper de retrieval da Knowledge Base (F3-S05).

Separado da tool para facilitar teste unitário do ranking/SQL sem passar pelo
contrato `Tool`. Faz a busca híbrida sob RLS:

  1. embed da query (EmbeddingsProvider, OpenAI direto — F3-S02);
  2. SQL asyncpg sob `with_workspace`: candidatos por distância cosine (HNSW,
     operador `<=>`) + `ts_rank` FTS pt, filtrando apenas documentos
     `status='active' AND visible_to_agents`, com join para `priority`;
  3. re-rank combinando similaridade vetorial + FTS + priority + sinal de
     feedback (`helpful`), retornando top-`k` com citações.

A query é parametrizada (vetor e termos viajam como bind params); nada de input
do modelo é interpolado em SQL.
"""

from __future__ import annotations

from dataclasses import dataclass

import asyncpg

from app.db import with_workspace

# Pesos do ranking combinado. Empíricos/conservadores: a similaridade vetorial
# domina; FTS e priority ajustam; feedback dá um nudge pequeno. Ajustável.
_W_VECTOR = 1.0
_W_FTS = 0.3
_W_PRIORITY = 0.05
_W_FEEDBACK = 0.1
# Quantos candidatos puxar antes do re-rank (overfetch para o ranking decidir).
_CANDIDATE_MULTIPLIER = 4
_MIN_CANDIDATES = 20


@dataclass(frozen=True)
class RetrievedChunk:
    """Um trecho recuperado, com citação e score combinado."""

    document_id: str
    chunk_id: str
    title: str
    content: str
    score: float


def _to_pgvector(embedding: list[float]) -> str:
    """Serializa um vetor Python para o literal pgvector `[a,b,c]`."""
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


# SQL do retrieval híbrido. Notas:
#  - `embedding <=> $1` = distância cosine (0 = idêntico); convertemos para
#    similaridade `1 - dist`.
#  - `ts_rank` usa o índice FTS gin pt; `plainto_tsquery` trata a query como texto.
#  - feedback agregado: `helpful` count - not-helpful count por chunk.
#  - só chunks com embedding não-nulo e doc active+visible entram.
_RETRIEVAL_SQL = """
WITH feedback_agg AS (
  SELECT
    chunk_id,
    SUM(CASE WHEN helpful THEN 1 ELSE -1 END) AS feedback_score
  FROM kb_feedback
  WHERE chunk_id IS NOT NULL
  GROUP BY chunk_id
)
SELECT
  c.id::text          AS chunk_id,
  c.document_id::text AS document_id,
  d.title             AS title,
  c.content           AS content,
  (1 - (c.embedding <=> $1::vector))                                  AS vector_sim,
  ts_rank(to_tsvector('portuguese', c.content),
          plainto_tsquery('portuguese', $2))                          AS fts_rank,
  d.priority                                                          AS priority,
  COALESCE(f.feedback_score, 0)                                       AS feedback_score
FROM kb_chunks c
JOIN kb_documents d ON d.id = c.document_id
LEFT JOIN feedback_agg f ON f.chunk_id = c.id
WHERE c.embedding IS NOT NULL
  AND d.status = 'active'
  AND d.visible_to_agents = true
ORDER BY c.embedding <=> $1::vector
LIMIT $3
"""


def _combined_score(
    vector_sim: float,
    fts_rank: float,
    priority: int,
    feedback_score: int,
) -> float:
    """Score combinado normalizado por pesos. Maior = mais relevante."""
    # priority 0..10 -> 0..1; feedback clamp para não dominar.
    priority_norm = max(0, min(priority, 10)) / 10.0
    feedback_norm = max(-3, min(feedback_score, 3)) / 3.0
    return (
        _W_VECTOR * vector_sim
        + _W_FTS * fts_rank
        + _W_PRIORITY * priority_norm
        + _W_FEEDBACK * feedback_norm
    )


async def retrieve(
    pool: asyncpg.Pool,
    *,
    workspace_id: str,
    query_embedding: list[float],
    query_text: str,
    k: int,
) -> list[RetrievedChunk]:
    """Busca híbrida + re-rank. Retorna top-`k` chunks sob RLS do workspace.

    Base vazia (sem chunks indexados) -> lista vazia, sem erro.
    """
    candidate_limit = max(_MIN_CANDIDATES, k * _CANDIDATE_MULTIPLIER)
    vector_literal = _to_pgvector(query_embedding)

    async with pool.acquire() as conn:
        async with with_workspace(conn, workspace_id) as scoped:
            rows = await scoped.fetch(
                _RETRIEVAL_SQL,
                vector_literal,
                query_text,
                candidate_limit,
            )

    scored: list[RetrievedChunk] = []
    for row in rows:
        score = _combined_score(
            vector_sim=float(row["vector_sim"]),
            fts_rank=float(row["fts_rank"]),
            priority=int(row["priority"]),
            feedback_score=int(row["feedback_score"]),
        )
        scored.append(
            RetrievedChunk(
                document_id=row["document_id"],
                chunk_id=row["chunk_id"],
                title=row["title"],
                content=row["content"],
                score=round(score, 6),
            )
        )

    scored.sort(key=lambda c: c.score, reverse=True)
    return scored[:k]
