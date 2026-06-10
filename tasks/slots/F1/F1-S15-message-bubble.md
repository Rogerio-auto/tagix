---
id: F1-S15
title: MessageBubble — discriminated union (text/image/.../interactive); IG em stubs
phase: F1
status: in-progress
priority: high
estimated_size: L
depends_on: [F1-S13, F1-S05, F1-S10]
agent_id: backend-engineer
claimed_at: 2026-06-10T01:02:53Z

---
# F1-S15 — MessageBubble

> **source_docs:** `docs/features/LIVECHAT.md` §4 (tipos), §10.2 (DS); `docs/DESIGN_SYSTEM.md` §10.2
> **blocks:** F1-S20

## Objetivo
Renderização polimórfica de mensagens por `type`, via switch sobre a discriminated union, com bubbles inbound/outbound + status icons.

## Escopo (faz)
- `apps/web/features/conversations/components/MessageBubble/**` — Text/Image(lightbox)/Video/Audio/Voice(waveform)/Document/Sticker/Location/Contact/InteractiveButtons/InteractiveList/Template/Reaction/System. IG (StoryMention/StoryReply/Share/Comment/QuickReplies/GenericTemplate/Referral) como **placeholders** (impl F1.5).
- Status icon (clock/check/double-check/eye verde) + placeholder de mídia até `media_ready`.

## Arquivos permitidos
- `apps/web/features/conversations/components/MessageBubble/**`

## Definition of Done
- [ ] Todos os tipos não-IG renderizam corretamente (in/out, radius, status).
- [ ] IG types em stubs visuais; mídia troca placeholder→carregada via socket.
- [ ] Zero hex; dark/light; typecheck + lint + build.

## UX considerations
- Aplica DS §10.2 (bubble in/out, system centered) e §8 (a11y: aria-live no container — coordenar com S13).
- Aplica §2.7 (placeholder de mídia, não spinner solto).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
