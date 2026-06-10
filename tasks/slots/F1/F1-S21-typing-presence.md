---
id: F1-S21
title: Typing/recording presence (pre_action)
phase: F1
status: review
priority: low
estimated_size: S
depends_on: [F1-S07, F1-S11]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:44:50Z
completed_at: 2026-06-10T00:44:50Z

---
# F1-S21 — Typing/recording presence

> **source_docs:** `docs/features/LIVECHAT.md` §3.5, §6 (typing:from_contact)
> **blocks:** —

## Objetivo
Indicadores de digitando/gravando: outbound dispara `sendTypingIndicator` antes do envio (pre_action); inbound de presença emite `typing:from_contact` ao front.

## Escopo (faz)
- Worker outbound: `pre_action` → `adapter.sendTypingIndicator` + sleep antes do send.
- Relay: presença inbound → `typing:from_contact`. Frontend: indicador animado no ConversationPanel.

## Arquivos permitidos
- `apps/workers/src/outbound/presence.ts`, `apps/web/features/conversations/components/TypingIndicator.tsx`

## Definition of Done
- [ ] Pre-action dispara typing antes do envio; indicador aparece/some no front.
- [ ] `prefers-reduced-motion` respeitado; typecheck + lint + build.

## UX considerations
- Aplica DS §7 / UX §3.10 (animação curta, intencional).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
