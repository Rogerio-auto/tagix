---
id: F38-S10
title: API inbox de suporte no (platform) — triagem/reply/status
phase: F38
status: review
priority: high
estimated_size: M
depends_on:
  - F38-S07
  - F38-S08
blocks:
  - F38-S11
source_docs:
  - docs/features/SUPPORT.md
agent_id: backend-engineer
claimed_at: 2026-06-18T15:45:23Z
completed_at: 2026-06-18T15:49:03Z

---
# F38-S10 — API inbox de suporte (platform)

## Objetivo

Endpoints cross-workspace para a equipe Leadium triar e responder threads de suporte. Gated por `requirePlatformAdmin`. Consome `supportRepo` (S01) e emite via `support-realtime` (S08).

## Contexto

`requirePlatformAdmin` audita acesso. platform-admin faz **bypass** da RLS de tenant (vê todos os workspaces) — mesmo padrão dos painéis platform existentes (F25/F26). Emit de eventos via service do S08.

## Escopo (faz)

- **`apps/api/src/routes/platform/support.ts`** (novo) — sob `requirePlatformAdmin`: `GET /platform/support/threads` (lista cross-workspace + filtros status/priority/workspace/assigned), `GET /platform/support/threads/:id` (+ mensagens), `POST .../:id/messages` (`sender_type='platform'`), `PATCH .../:id` (status/priority/assign). Emite `support:message`/`support:thread_updated`.
- **`apps/api/src/routes/platform/index.ts`** — registrar `/platform/support`.
- **`packages/shared/src/support.ts`** — estender com Zod de filtros/patch do platform (coordenar com S07).
- **`apps/api/src/routes/platform/support.test.ts`** — gate (não-admin negado+auditado); lista cross-workspace; reply emite; patch de status/assign.

## Fora de escopo

- UI (S11). API do membro (S07). Socket service (S08). Schema (S01).

## Arquivos permitidos

- `apps/api/src/routes/platform/support.ts`
- `apps/api/src/routes/platform/support.test.ts`
- `apps/api/src/routes/platform/index.ts`
- `packages/shared/src/support.ts`
- `packages/shared/src/index.ts`

## Arquivos proibidos

- `apps/web/**`, `packages/db/**`, `apps/api/src/routes/support.ts`

## Definition of Done

- [ ] Lista cross-workspace com filtros; reply/patch funcionam e emitem real-time.
- [ ] Gate `requirePlatformAdmin` cobre tudo; não-admin negado e auditado.
- [ ] Integration test passa; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Notas

Reusar o emit do `support-realtime` (S08) — não duplicar lógica de socket. `packages/shared/src/support.ts` é compartilhado com S07 (coordenar barrel via COMMS se em paralelo).
</content>
