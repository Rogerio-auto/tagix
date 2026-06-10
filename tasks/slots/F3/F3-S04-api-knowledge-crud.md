---
id: F3-S04
title: API CRUD Knowledge Base + enqueue ingest + envelope kb.document.ingest
phase: F3
status: done
priority: high
estimated_size: M
depends_on: [F3-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T16:10:36Z
completed_at: 2026-06-10T16:18:09Z

---
# F3-S04 — API CRUD Knowledge Base

> **source_docs:** `docs/DATA_MODEL.md` §8; `docs/features/PERMISSIONS.md` (kb.edit); `docs/ROADMAP.md` F3-S04
> **blocks:** F3-S03, F3-S06

## Objetivo
API REST para gerenciar documentos da KB: criar (upload markdown/texto → cria `kb_documents` com `status='processing'` + dedup por `content_sha256` + **publica** `kb.document.ingest`), listar, obter (com chunks/preview), atualizar metadados, reprocessar e arquivar/deletar. Define o **envelope da fila de ingestão** (contrato para F3-S03).

## Escopo (faz)
- `apps/api/src/routes/knowledge/**`: factory de router (montada em `app.ts` pelo orchestrator, padrão F2-S19) com:
  - `POST /api/knowledge/documents` — valida Zod, calcula `content_sha256` (409 em duplicado), cria doc `processing`, publica `kb.document.ingest`.
  - `GET /api/knowledge/documents` — lista paginada + filtros (`status`, `category`, busca por título).
  - `GET /api/knowledge/documents/:id` — doc + chunks (preview).
  - `PATCH /api/knowledge/documents/:id` — metadados (title, category, tags, priority, status, visible_to_agents).
  - `POST /api/knowledge/documents/:id/reprocess` — republica `kb.document.ingest` (`reason: 'reprocess'`).
  - `DELETE /api/knowledge/documents/:id` — archive/delete (cascade em chunks via FK).
- `packages/shared/src/mq/kb.ts`: Zod do envelope `{ workspaceId, documentId, reason }` + nome da fila.
- `packages/shared/src/mq/topology.ts`: declarar a fila/binding `kb.document.ingest`.

## Fora de escopo
- Consumir a fila / chunking / embeddings (F3-S03), retrieval (F3-S05), UI (F3-S06), feedback (F3-S07).

## Arquivos permitidos
- `apps/api/src/routes/knowledge/**`
- `packages/shared/src/mq/kb.ts`
- `packages/shared/src/mq/topology.ts`
- `packages/shared/src/mq/index.ts`

## Contratos de saída
- REST acima (consumido por F3-S06).
- Envelope `kb.document.ingest` em `@hm/shared` (consumido read-only por F3-S03).

## Definition of Done
- [ ] CRUD completo sob RLS (`withRLS`), validação Zod em toda input, dedup `content_sha256`.
- [ ] `POST` cria doc `processing` e publica `kb.document.ingest`; `reprocess` republica.
- [ ] Escrita exige `requireRole('kb.edit')` (MANAGERS); leitura idem (KB é área de gestão).
- [ ] `pnpm --filter @hm/api test` (mq/db mockados) + lint/typecheck verdes.

## Permission scope
- Todas as rotas de escrita e leitura gated por `kb.edit` (= MANAGERS, vide `packages/shared/src/permissions.ts`). Agentes leem a KB internamente via tool (F3-S05), não por esta API.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Publica via helper `@hm/shared/mq` (F0-S13). Mantenha o envelope mínimo (`{ workspaceId, documentId, reason }`) — o worker relê o doc do banco.
- Como produtor da fila, este slot é dono do envelope e da topologia; F3-S03 apenas consome.
