---
id: F1-S05
title: Schema contacts + conversations + messages + repos + interactive types
phase: F1
status: review
priority: critical
estimated_size: L
depends_on: [F1-S01]
agent_id: backend-engineer
claimed_at: 2026-06-09T22:48:36Z
completed_at: 2026-06-09T22:53:49Z

---
# F1-S05 — Schema contacts/conversations/messages

> **source_docs:** `docs/DATA_MODEL.md` §5 (contacts), §6.3 (conversations), §6.4 (messages); `docs/features/LIVECHAT.md` §4 (tipos), §4.1 (interactive_payload)
> **blocks:** F1-S04, F1-S07, F1-S10, F1-S12, F1-S15, F1-S22, F1-S23

## Objetivo
Núcleo de dados do LiveChat: contacts, conversations (kind: direct/group/story_thread/comment_thread), messages (type discriminado com tipos IG) + repos Drizzle + tipos `interactive_payload` (Zod) compartilhados.

## Escopo (faz)
- `packages/db/src/schema/{contacts,conversations,messages}.ts` conforme DATA_MODEL (FKs, índices, RLS no mesmo PR). `messages.type` cobre text/image/video/audio/voice/document/sticker/location/contact/interactive/template/reaction/system + IG (story_mention/story_reply/share/comment/ig_postback/referral).
- `packages/shared/src/types/interactive.ts` — `InteractivePayloadSchema` (discriminated union Zod: buttons/list/template) — exportado via subpath ou barrel principal (tipos puros, ok no barrel).
- `packages/db/src/repos/{contacts,conversations,messages}.ts` — queries básicas + cursor pagination de messages.

## Arquivos permitidos
- `packages/db/src/schema/{contacts,conversations,messages}.ts`, `packages/db/src/repos/**`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`, `packages/db/src/index.ts`, `packages/shared/src/types/interactive.ts`, `packages/shared/src/index.ts`

## Definition of Done
- [ ] 3 tabelas + RLS testada; índices para list (workspace_id, last_message_at DESC) e lookup (channel_id, remote_id).
- [ ] `interactive_payload` validado por Zod no boundary.
- [ ] repos com cursor pagination; typecheck/lint/migrate/test limpos.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
pnpm --filter @hm/db test
```

## Notas
Termos v2: `contact` (não customer/lead), `conversation` (não chat). `ai_mode` boolean ortogonal ao status.
