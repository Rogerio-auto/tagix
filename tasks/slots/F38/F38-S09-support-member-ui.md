---
id: F38-S09
title: UI launcher + chat de suporte no (app)
phase: F38
status: in-progress
priority: high
estimated_size: M
depends_on:
  - F38-S07
  - F38-S08
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T17:24:44Z

---
# F38-S09 — UI chat de suporte (membro)

## Objetivo

Launcher "Falar com suporte" dentro da Central de Ajuda + lista de threads + view de chat real-time com a equipe Leadium. Consome a API (S07) e o socket (S08).

## Contexto

Leitor `/help` existe (S05) e reservou espaço de layout para o launcher. Socket client já é usado nas conversas (`apps/web/features/conversations/hooks/*`) — reusar o padrão de hook de socket. DS v2, responsivo (Sheet da F36).

## Escopo (faz)

- **`apps/web/features/support/**`** (novo) — launcher "Falar com suporte", lista de meus threads (status/última msg), view de chat (mensagens em tempo real via socket, composer, resolver), queries + hook de socket. Estados loading/error/empty; otimismo no envio.
- **Montagem no `/help`** — `apps/web/app/(app)/help/page.tsx` e/ou `apps/web/features/help/**`: inserir o launcher no ponto previsto por S05. Tocar só o ponto de montagem.

## Fora de escopo

- Inbox platform (S11). API/socket backend (S07/S08).

## Arquivos permitidos

- `apps/web/features/support/**`
- `apps/web/app/(app)/help/page.tsx`
- `apps/web/features/help/**`

## Arquivos proibidos

- `apps/web/features/platform-admin/**`, `apps/api/**`, `packages/db/**`

## Definition of Done

- [ ] Abrir thread, listar, conversar em tempo real, resolver — tudo pela UI.
- [ ] Mensagens chegam via socket sem refresh; reconexão tratada.
- [ ] Responsivo; DS v2 tokens; ARIA; estados completos.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Notas

Reusar o hook de socket das conversas como referência (não copiar lógica de Meta). Branding "Leadium" ("Suporte Leadium").
</content>
