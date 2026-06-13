---
id: F15-S05
title: IG comments/stories API — endpoints de moderação (reply pub/priv, hide, delete, list)
phase: F15
status: done
priority: high
estimated_size: M
depends_on: [F15-S03, F15-S04]
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-13T00:16:32Z
completed_at: 2026-06-13T00:21:02Z

---
# F15-S05 — IG comments/stories API

> **source_docs:** `docs/features/INSTAGRAM.md` §7, §8; `docs/features/PERMISSIONS.md`
> **blocks:** F15-S08

## Objetivo

Endpoints REST para moderação de comentários IG e leitura de threads: listar comments de um post/reel, responder publicamente, responder por DM (private reply), ocultar e excluir — enfileirando os `OutboundJob` IG (que F15-S04 despacha) e lendo de `ig_comments`. Gated por permissão (atendente/admin).

## Contexto

A persistência (ig_comments) é feita pelo inbound (F15-S03) e as ações de canal pelo outbound (F15-S04). Este slot é a camada HTTP que o frontend (F15-S08) consome: valida input (Zod), checa permissão, e enfileira a ação ou lê o thread.

## Escopo (faz)

- `apps/api/src/routes/instagram/**` (novo): `GET /instagram/comments?mediaId=` (lista thread de `ig_comments` sob RLS), `POST /instagram/comments/:commentId/reply` (`{ mode: 'public'|'private', text }` → enfileira `ig_public_reply`/`ig_private_reply`), `POST /instagram/comments/:commentId/hide`, `DELETE /instagram/comments/:commentId` — todos Zod + permissão.
- `apps/api/src/services/instagram/**` (novo, se precisar): orquestra enqueue + leitura.

## Fora de escopo

- Dispatch real (F15-S04). Persistência (F15-S03). UI (F15-S08). Connect (F15-S06).

## Arquivos permitidos

- `apps/api/src/routes/instagram/**`
- `apps/api/src/services/instagram/**`

## Arquivos proibidos

- `apps/api/src/routes/conversations/**` (DM IG já flui pela conversa normal — não duplicar)
- `apps/api/src/app.ts` (wire é do orchestrator)

## Definition of Done

- [ ] Endpoints de list/reply(pub+priv)/hide/delete funcionam, enfileirando os OutboundJob IG corretos; list lê `ig_comments` sob RLS.
- [ ] Zod em toda input; permission scope (só `owner`/`admin`/`supervisor` modera — cf. PERMISSIONS §2); cross-tenant negado.
- [ ] `pnpm --filter @hm/api test` (rotas IG comments) + lint/typecheck verdes.

## Permission scope

Moderação de comments: `owner`/`admin`/`supervisor` (atendentes respondem; viewer não). Ver `docs/features/PERMISSIONS.md §2` + INSTAGRAM.md §7.2.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Exporta `createInstagramRouter()` para o orchestrator montar em `app.ts`. Reusa a fila/contratos de `OutboundJob` da F15-S01/S04.
