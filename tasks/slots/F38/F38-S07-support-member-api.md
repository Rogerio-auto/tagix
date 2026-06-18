---
id: F38-S07
title: API suporte do membro (abrir/listar/responder/resolver)
phase: F38
status: available
priority: high
estimated_size: M
depends_on:
  - F38-S01
blocks:
  - F38-S08
  - F38-S09
  - F38-S10
source_docs:
  - docs/features/SUPPORT.md
agent_id: backend-engineer
---
# F38-S07 — API suporte do membro

## Objetivo

Endpoints para o membro do workspace abrir e tocar seus próprios threads de suporte com a equipe Leadium. Consome `supportRepo` (S01). Base para o real-time (S08), a UI do membro (S09) e o inbox platform (S10).

## Contexto

RLS de `support_threads`/`support_messages` isola por workspace. Espelhar o padrão `assertConversationVisible` da F30: acesso fora do escopo → **404** (não 403). Zod em `@hm/shared` (exports explícitos).

## Escopo (faz)

- **`apps/api/src/routes/support.ts`** (novo) — `requireAuth`: `POST /api/support/threads` (subject + primeira mensagem), `GET /api/support/threads` (meus), `GET /api/support/threads/:id` (+ mensagens; `assertThreadVisible`), `POST /api/support/threads/:id/messages` (`sender_type='member'`), `POST /api/support/threads/:id/resolve`. `last_message_at` atualizado a cada mensagem.
- **`apps/api/src/app.ts`** — montar `/api/support` (só a linha de montagem).
- **`packages/shared/src/support.ts`** (novo) — Zod de payloads/responses + enums (status/priority).
- **`packages/shared/src/index.ts`** — export explícito de `./support`.
- **`apps/api/src/routes/support.test.ts`** — IDOR: membro de B não acessa thread de A (404); criação; post message; resolve.

## Fora de escopo

- Real-time/socket (S08). Inbox platform (S10). UI (S09). Schema (S01).

## Arquivos permitidos

- `apps/api/src/routes/support.ts`
- `apps/api/src/routes/support.test.ts`
- `apps/api/src/app.ts`
- `packages/shared/src/support.ts`
- `packages/shared/src/index.ts`

## Arquivos proibidos

- `apps/web/**`, `packages/db/**`, `apps/api/src/routes/platform/**`

## Definition of Done

- [ ] CRUD de threads/mensagens do membro; `assertThreadVisible` em todo `/:id/*` → 404 fora do escopo.
- [ ] Zod valida input; enums em `@hm/shared`.
- [ ] Integration test cobre IDOR; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Notas

`assertThreadVisible` é util reusável — o inbox platform (S10) faz bypass (platform-admin vê todos). Anexos via storage existente são opcionais nesta primeira entrega.
</content>
