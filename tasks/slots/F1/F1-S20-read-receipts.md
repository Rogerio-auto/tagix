---
id: F1-S20
title: Read receipts e delivery status (status callbacks Meta WA)
phase: F1
status: blocked
priority: medium
estimated_size: S
depends_on: [F1-S07, F1-S11, F1-S15]
---

# F1-S20 — Read receipts / delivery status

> **source_docs:** `docs/features/LIVECHAT.md` §6 (message:status_changed), §4
> **blocks:** —

## Objetivo
Processar status callbacks (sent/delivered/read/failed) do WhatsApp e refletir nos ícones de status das mensagens em tempo real.

## Escopo (faz)
- Worker inbound trata `InboundEvent type=status` → update `messages.view_status` → emit `message:status_changed`.
- Frontend: ícone de status no MessageBubble reage ao evento (clock→check→double-check→eye verde).

## Arquivos permitidos
- `apps/workers/src/inbound/status.ts`, `apps/web/features/conversations/components/MessageBubble/status.tsx` (sequencial após F1-S15)

## Definition of Done
- [ ] Status persiste e atualiza o ícone em tempo real.
- [ ] typecheck + lint + build.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
