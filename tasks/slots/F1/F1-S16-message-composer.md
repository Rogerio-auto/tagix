---
id: F1-S16
title: MessageComposer — textarea + media upload + emoji + mention @ + reply
phase: F1
status: in-progress
priority: high
estimated_size: M
depends_on: [F1-S13, F1-S12]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:30:25Z

---
# F1-S16 — MessageComposer

> **source_docs:** `docs/features/LIVECHAT.md` §7.3, §5.2 (upload); `docs/UX_PRINCIPLES.md`
> **blocks:** F1-S17

## Objetivo
Composer de envio: textarea, emoji picker, anexo de mídia (signed URL R2), menção `@member`, modo reply, e atalho Cmd+Enter.

## Escopo (faz)
- `apps/web/features/conversations/components/MessageComposer/**` + upload via `POST /api/uploads/signed-url` (rota incluída aqui ou em F1-S12) + envio `POST /api/conversations/:id/messages`.
- Emoji picker, mention `@` (dropdown de members), quote/reply indicator, Cmd+Enter envia.

## Arquivos permitidos
- `apps/web/features/conversations/components/MessageComposer/**`, `apps/web/features/conversations/queries.ts`

## Definition of Done
- [ ] Envio de texto + mídia (upload assinado) funciona; emoji + mention + reply.
- [ ] Feedback de envio (botão loading, sem duplo-disparo).
- [ ] typecheck + lint + build.

## UX considerations
- Aplica UX §2.7 (click-fantasma): botão de envio em loading + disabled.
- Aplica §2.1 (ação primária = clique no corpo/Send, não em ícone obscuro).
- Lock de 24h é F1-S17 (este slot deixa o hook `getComposerState` pronto).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
