---
id: F3-S01
title: Schema Knowledge Base (kb_documents, kb_chunks pgvector, kb_feedback) + RLS
phase: F3
status: in-progress
priority: critical
estimated_size: M
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-10T15:59:34Z

---
# F3-S01 — Schema Knowledge Base (pgvector)

> **source_docs:** `docs/DATA_MODEL.md` §8 (Knowledge Base); `docs/ROADMAP.md` F3-S01
> **blocks:** F3-S03, F3-S04, F3-S05, F3-S07

## Objetivo
Modelar o domínio de Knowledge Base em Drizzle + Postgres com RLS multi-tenant: `kb_documents`, `kb_chunks` (com `vector(1536)` + índice HNSW cosine + FTS português) e `kb_feedback`. Migrations geradas (tabela + extensão `vector` + índices + RLS).

## Escopo (faz)
- `packages/db/src/schema/knowledge.ts`: as 3 tabelas conforme DATA_MODEL §8, todas `workspace_id`-scoped com FKs coerentes (`document_id`→kb_documents, `chunk_id`→kb_chunks, `agent_id`→agents, `conversation_id`→conversations, `created_by`→members), CHECKs de enum (`source`, `status`), defaults e `UNIQUE(document_id, chunk_index)`.
- Tipo custom Drizzle para `vector(1536)` (drizzle-kit não gera pgvector nativamente) — coluna `embedding vector(1536)` nullable em `kb_chunks`.
- Migration **custom** para: `CREATE EXTENSION IF NOT EXISTS vector`, índice HNSW (`hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`), índice FTS gin (`to_tsvector('portuguese', content)`) e os índices b-tree de leitura (§8.1/§8.2/§8.3).
- Barrel `schema/index.ts`: exportar tabelas + adicionar ao `RLS_TABLES`.
- Migration de RLS por `current_setting('app.workspace_id', true)::uuid` nas 3 tabelas (convenção dos slots F1/F2, ex. `00NN_*_rls.sql`).

## Fora de escopo
- Ingestão/chunking (F3-S03), embeddings (F3-S02), retrieval (F3-S05), API/UI (F3-S04/S06/S07).

## Arquivos permitidos
- `packages/db/src/schema/knowledge.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Contratos de saída
- Tabelas e colunas com os nomes/tipos exatos do DATA_MODEL §8 (consumidos por asyncpg no Python e Drizzle no Node — nomes são contrato).
- `kb_chunks.embedding` = `vector(1536)` nullable (preenchido na ingestão).

## Definition of Done
- [ ] As 3 tabelas criadas com tipos/enums/índices conforme DATA_MODEL §8.
- [ ] Extensão `vector` + índice HNSW + índice FTS pt criados via migration custom (sem editar journal à mão).
- [ ] RLS policy criada e testada nas 3 tabelas (isolamento por `app.workspace_id` — teste de integração confirma que outro workspace não lê).
- [ ] `pnpm --filter @hm/db typecheck` verde.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- `embedding` é nullable de propósito: o chunk é persistido na ingestão e o vetor pode ser preenchido num segundo passo idempotente (F3-S03).
- HNSW exige pgvector ≥ 0.5 — a imagem de infra (`pgvector`) já atende. Confirme a versão no compose se a migration falhar.
