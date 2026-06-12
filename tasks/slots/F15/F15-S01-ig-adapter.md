---
id: F15-S01
title: IG adapter completo — parser + serializer + comments + stories + errors (channels)
phase: F15
status: available
priority: critical
estimated_size: L
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/features/LIVECHAT.md
---

# F15-S01 — IG adapter completo (channels)

> **source_docs:** `docs/features/INSTAGRAM.md` §5, §6, §7, §8; `docs/features/LIVECHAT.md` §2/§3
> **blocks:** F15-S02, F15-S03, F15-S04, F15-S06
> **F1.5 — Instagram channel completion** (fase deferida; schema já ready).

## Objetivo

Substituir o `MetaInstagramAdapter` STUB pela implementação real: parsing de webhook IG (DM, story_mention, story_reply, share, postback, reaction, seen, referral, comments, mentions), serializers de envio (text, media, interactive, message_tag), módulos de comments (list/hide/delete/reply público+privado) e stories (download de mídia com URL expirável), errors tipados IG, e extensão do `GraphClient` compartilhado para endpoints IG — tudo coberto por testes unitários.

## Contexto

`packages/channels/src/meta/instagram/adapter.ts` hoje é STUB (capabilities corretas, métodos retornam erro tipado/lista vazia). O schema já está ready (messages.type inclui todos os subtipos IG; ig_comments existe com RLS; conversations.kind tem story_thread/comment_thread). Este slot é a fundação do canal IG — todos os outros slots da F1.5 consomem o adapter.

## Escopo (faz)

- `packages/channels/src/meta/instagram/webhook.parser.ts`: `parseInbound(payload, channel) → InboundEvent[]` cobrindo `entry[].messaging[]` (DM/story/share/postback/reaction/seen/referral, skip echoes/deleted) e `entry[].changes[]` (comments/mentions). Espelha INSTAGRAM.md §5.2.
- `packages/channels/src/meta/instagram/serializer.ts`: text, media (image/video/audio/file), interactive (quick_replies/generic_template), MESSAGE_TAG vs RESPONSE.
- `packages/channels/src/meta/instagram/comments.ts`: list/hide/delete + reply público (`/{commentId}/replies`) + privado (`recipient.comment_id`).
- `packages/channels/src/meta/instagram/stories.ts`: download de mídia de story (URL temporária ~5min) via GraphClient.
- `packages/channels/src/meta/instagram/errors.ts`: hierarquia de erros IG (IG_NO_HSM, IG_WINDOW_CLOSED, etc.).
- `packages/channels/src/meta/instagram/adapter.ts`: implementação real de todos os métodos (sendText/sendMedia/sendInteractive/sendPrivateReplyToComment/replyPublicToComment/hideComment/deleteComment/downloadMedia/markAsRead/sendTypingIndicator; sendTemplate → IG_NO_HSM tipado).
- `packages/channels/src/shared/graphClient.ts`: extensão ADITIVA p/ endpoints IG v23.0 (sem quebrar WA).
- `packages/channels/src/types.ts`: estender `OutboundJob` com os kinds IG (`ig_private_reply`, `ig_public_reply`, `ig_hide_comment`) + `IgMessageTag` (INSTAGRAM.md §5.3) — aditivo.
- `packages/channels/src/index.ts`: exports.
- Testes unitários: `webhook.parser.test.ts`, `serializer.test.ts` (fixtures de payloads IG reais do doc).

## Fora de escopo

- Persistência (F15-S03), ingestão webhook na API (F15-S02), dispatch outbound (F15-S04), API de comments (F15-S05), connect (F15-S06), frontend (F15-S07/S08).

## Arquivos permitidos

- `packages/channels/src/meta/instagram/**`
- `packages/channels/src/shared/graphClient.ts`
- `packages/channels/src/types.ts`
- `packages/channels/src/index.ts`

## Arquivos proibidos

- `packages/channels/src/meta/whatsapp/**`, `packages/channels/src/waha/**` (não regredir)

## Contratos de entrada/saída

- `MetaInstagramAdapter implements IChannelAdapter` (provider `meta_instagram`), parseInbound retorna `InboundEvent[]` no mesmo contrato que o WA adapter consome em S02/S03.
- `OutboundJob` union estendida com kinds IG — consumida por F15-S04.

## Definition of Done

- [ ] Todos os subtipos de webhook IG parseados em `InboundEvent` (DM/story_mention/story_reply/share/postback/reaction/seen/referral/comment/mention); echoes/deleted ignorados.
- [ ] Envio real (text/media/interactive/message_tag) + comment actions (reply pub/priv, hide, delete) + download de story; sendTemplate → erro `IG_NO_HSM` tipado.
- [ ] WhatsApp/WAHA adapters **inalterados** (testes deles continuam verdes).
- [ ] `pnpm --filter @hm/channels test` (parser/serializer com fixtures) + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/channels test
```

## Notas

- Especialista: **backend-engineer**.
- HMAC/signature é compartilhado (`shared/hmac.ts`) — não duplicar. GraphClient extension é aditiva (WA usa o mesmo cliente). Fixtures de payload: INSTAGRAM.md §5, §7, §8.
