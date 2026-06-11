---
id: F8-S09
title: Contacts API — list/search/detail/CRUD + tags + histórico de consentimento
phase: F8
status: available
priority: high
estimated_size: M
depends_on: []
---
# F8-S09 — Contacts API

> **source_docs:** `docs/DATA_MODEL.md` §5; `docs/features/CAMPAIGNS.md` §9.4 (consentimento); `docs/ROADMAP.md` F8 (Contatos)
> **blocks:** F8-S10

## Objetivo
API geral de contatos (hoje só existe `opt-in.ts`): listar paginado + busca (nome/phone/email), detalhe, criar/editar, atribuir/remover `tags` (via `contact_tags`), e o histórico de consentimento (opt-in/opt-out timeline a partir das colunas de `contacts`).

## Escopo (faz)
- `apps/api/src/routes/contacts/contacts.ts`: `GET /api/contacts` (paginado + filtros: tag, source, opt-in, busca), `GET /api/contacts/:id` (detalhe + tags + conversas + deals + conversões), `POST`/`PATCH`, `DELETE` (soft), e `POST/DELETE /api/contacts/:id/tags`.
- `GET /api/contacts/:id/consent` — timeline de opt-in/opt-out (reusa colunas de F1-S05 + audit).

## Fora de escopo
- Opt-in/opt-out de campanha (já em `opt-in.ts`, F6-S04), UI (F8-S10).

## Arquivos permitidos
- `apps/api/src/routes/contacts/contacts.ts`
- `apps/api/src/routes/contacts/index.ts`

## Arquivos proibidos
- `apps/api/src/routes/contacts/opt-in.ts` (dono: F6-S04)

## Permission scope
- Ver/editar contatos → STAFF (`contact.view`/`contact.edit` — usar/adicionar em `permissions.ts` se faltar); deletar → ADMINS. RLS por workspace.

## Definition of Done
- [ ] CRUD + busca paginada + tags assign/remove + consent timeline, tudo sob RLS + Zod.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- `contacts` + `tags`/`contact_tags` já existem (F1-S05/F5-S01). Este slot só expõe a API geral de gestão.
