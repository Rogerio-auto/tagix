---
id: F1-S14
title: ChatList — real-time + filtros (incl. provider) + search + scroll infinito
phase: F1
status: done
priority: high
estimated_size: M
depends_on: [F1-S13, F1-S11, F1-S12]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:30:14Z
completed_at: 2026-06-10T00:30:19Z

---
# F1-S14 — ChatList

> **source_docs:** `docs/features/LIVECHAT.md` §7.2; `docs/DESIGN_SYSTEM.md` §10.1; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo
Lista de conversas com filtros, busca, ordenação, scroll infinito e atualização em tempo real via socket.

## Escopo (faz)
- `apps/web/features/conversations/components/ChatList/**` + `hooks/useConversations.ts`, `hooks/useChatSocket.ts`.
- Filtros (status/department/team/assigned/tag/**provider**), search debounce 300ms, sort last_message_at DESC, lazy 50 + scroll infinito; ouve `conversation:updated`/`message:new` (bump).
- ChatList item conforme DS §10.1 (avatar, nome, preview, unread badge, chips).

## Arquivos permitidos
- `apps/web/features/conversations/components/ChatList/**`, `apps/web/features/conversations/hooks/**`

## Definition of Done
- [ ] Filtros + search + scroll infinito + real-time funcionam.
- [ ] Hover/active states (item ativo: border-left brand + surface-3); density aplicada.
- [ ] typecheck + lint + build.

## UX considerations
- Aplica UX §3.5 (cursor/hover ensina), §3.8 (density), §2.10 (setas navegam a lista — preparar).
- Aplica DS §10.1 (item) + §10.2 estados.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
