---
id: F3-S03
title: Ingest pipeline (worker) — chunking + embeddings + persist kb_chunks
phase: F3
status: blocked
priority: high
estimated_size: M
depends_on: [F3-S01, F3-S02, F3-S04]
---
# F3-S03 — Ingest pipeline (worker)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §7.3 (RAG ingest); `docs/DATA_MODEL.md` §8; `docs/ROADMAP.md` F3-S02 (parte pipeline)
> **blocks:** —

## Objetivo
Worker que consome a fila `kb.document.ingest` (publicada por F3-S04), faz **semantic/markdown-aware chunking** do `raw_content`, chama `POST /internal/embed` (F3-S02) para vetorizar cada chunk e persiste em `kb_chunks` de forma **idempotente**, atualizando `kb_documents.status` (`processing` → `active` | `error`).

## Escopo (faz)
- `apps/workers/src/knowledge/**`: consumer da fila `kb.document.ingest`, pipeline `load_document → chunk → embed → persist → mark_active`, lock por documento e idempotência (reprocesso apaga `kb_chunks` do doc e re-insere; re-delivery RabbitMQ é seguro).
- `apps/workers/src/knowledge/chunker.ts`: chunking determinístico respeitando headings markdown + limite de tokens (~512) com overlap, gerando `chunk_index`, `content_tokens`, `metadata` (heading path).
- `apps/workers/src/knowledge/embed-client.ts`: cliente HTTP tipado para `POST /internal/embed` (Bearer `AGENT_RUNTIME_TOKEN`), com batching e tratamento de erro 502.
- Bootstrap: registrar o consumer no entrypoint de workers (seguindo o padrão dos workers F1/F2).

## Fora de escopo
- Criar/expor o endpoint de embed (F3-S02), publicar a mensagem ou definir o envelope (F3-S04 é dono do contrato/topologia), retrieval (F3-S05).

## Arquivos permitidos
- `apps/workers/src/knowledge/**`

## Arquivos proibidos
- `packages/shared/src/mq/topology.ts` (dono: F3-S04)
- `packages/shared/src/mq/kb.ts` (dono: F3-S04 — importar read-only)

## Contratos de entrada
- Consome `kb.document.ingest` com envelope `{ workspaceId, documentId, reason: 'create' | 'reprocess' }` (Zod definido em F3-S04, importado de `@hm/shared`).
- Chama `POST /internal/embed` (contrato de F3-S02).

## Definition of Done
- [ ] Consumir a mensagem → chunks persistidos com `embedding` preenchido e `status='active'`.
- [ ] Idempotente: reprocessar o mesmo doc não duplica chunks (limpa antes de inserir); falha de embed marca `status='error'` sem deixar chunks órfãos.
- [ ] Erro do `/internal/embed` (502) não trava a fila (retry/backoff ou DLQ conforme convenção F0-S13).
- [ ] `pnpm --filter @hm/workers test` (asyncpg/http mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Persistência via `@hm/db` (Drizzle), sob contexto de workspace — workers NÃO importam de `apps/api`.
- Chunking é determinístico para reprocesso reprodutível; guarde o `heading path` em `metadata` para citações legíveis em F3-S07.
