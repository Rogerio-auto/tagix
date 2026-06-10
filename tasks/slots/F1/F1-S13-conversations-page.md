---
id: F1-S13
title: Frontend ConversationsPage — layout 3 colunas + ContactInfoPanel skeleton
phase: F1
status: done
priority: high
estimated_size: M
depends_on: [F0-S11, F0-S12, F1-S12]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:07:39Z
completed_at: 2026-06-10T00:14:09Z

---
# F1-S13 — ConversationsPage (shell 3 colunas)

> **source_docs:** `docs/DESIGN_SYSTEM.md` §5.2; `docs/features/LIVECHAT.md` §7; `docs/UX_PRINCIPLES.md`
> **blocks:** F1-S14, F1-S15, F1-S16

## Objetivo
A rota `/conversations` com o layout de 3 colunas (ChatList | ConversationPanel | ContactInfoPanel) e a estrutura de feature-folder, com estados empty/loading.

## Escopo (faz)
- `apps/web/app/(app)/conversations/page.tsx` + `[id]/page.tsx`.
- `apps/web/features/conversations/components/{ConversationsLayout,ContactInfoPanel}.tsx` + `queries.ts`/`types.ts` + `help.tsx`.
- ContactInfoPanel como toggle (botão no header). Empty state (UX §2.6) + loading (SkeletonList de F0-S12).

## Arquivos permitidos
- `apps/web/app/(app)/conversations/**`, `apps/web/features/conversations/**`

## Definition of Done
- [ ] Layout 3 colunas responsivo; ContactInfoPanel toggla.
- [ ] Empty/loading implementados; PageHeader com `?` (HelpPanel).
- [ ] Zero hex hardcoded; dark/light; typecheck + lint + `pnpm --filter @hm/web build`.

## UX considerations
- Aplica UX §2.3 (detalhe em painel lateral, não modal full-screen).
- Aplica §2.6 (empty state com CTA "Conectar canal") e §2.7/§3.6 (skeleton).
- Aplica §2.5 (HelpPanel `?` no header).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
