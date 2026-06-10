-- Custom SQL migration file, put your code below! --
-- F3-S01 — Índices pgvector/FTS de kb_chunks que o drizzle-kit não gera nativamente.
-- A extensão `vector` já foi criada em 0016 (pré-requisito da coluna embedding).
-- Ver DATA_MODEL §8.2.

-- HNSW cosine para vector search aproximado (m=16, ef_construction=64).
-- IF NOT EXISTS torna a migration idempotente em reaplicações parciais.
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
--> statement-breakpoint

-- Full-text search português (fallback/híbrido do retrieval — F3-S05).
CREATE INDEX IF NOT EXISTS idx_kb_chunks_fts_pt
  ON kb_chunks USING gin (to_tsvector('portuguese', content));
