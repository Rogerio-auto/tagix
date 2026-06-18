---
id: F38-S11
title: UI inbox de suporte no (platform) — real-time
phase: F38
status: review
priority: high
estimated_size: M
depends_on:
  - F38-S10
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T17:28:38Z
completed_at: 2026-06-18T17:33:11Z

---
# F38-S11 — UI inbox de suporte (platform)

## Objetivo

Inbox da equipe Leadium para atender suporte: lista cross-workspace com filtros, view de thread com reply real-time, e controles de status/priority/assign. Consome a API (S10) e o socket (S08).

## Contexto

Área `(platform)` com layout próprio; features em `apps/web/features/platform-admin/*`. Hook de socket reusável (referência: conversas / S09). DS v2, responsivo.

## Escopo (faz)

- **`apps/web/app/(platform)/platform/support/page.tsx`** (novo) — rota do inbox.
- **`apps/web/features/platform-admin/support/**`** (novo) — lista de threads (filtros status/priority/workspace), view de chat real-time, composer de reply, controles de status/priority/assign, badges de novos. Estados loading/error/empty.
- **`apps/web/features/platform-admin/shell/**`** — item "Suporte" na nav do painel platform (só o registro).

## Fora de escopo

- API (S10). UI do membro (S09).

## Arquivos permitidos

- `apps/web/app/(platform)/platform/support/page.tsx`
- `apps/web/features/platform-admin/support/**`
- `apps/web/features/platform-admin/shell/**`

## Arquivos proibidos

- `apps/web/features/support/**`, `apps/web/features/help/**`, `apps/api/**`, `packages/db/**`

## Definition of Done

- [ ] Lista cross-workspace com filtros; reply chega em tempo real; status/priority/assign refletem.
- [ ] DS v2 tokens; ARIA; estados completos; responsivo.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Notas

Coordenar o item de nav do shell platform com S04 (ambos tocam `platform-admin/shell`) — append, não sobrescrever. Branding "Leadium".
</content>
