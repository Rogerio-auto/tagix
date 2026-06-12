---
id: F15-S03
title: Inbound persistence IG — worker persiste DM/story/share/comment → conv/messages/ig_comments
phase: F15
status: blocked
priority: high
estimated_size: M
depends_on: [F15-S01, F15-S02]
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/features/LIVECHAT.md
---

# F15-S03 — Inbound persistence IG (workers)

> **source_docs:** `docs/features/INSTAGRAM.md` §3, §7, §8, §13, §14
> **blocks:** F15-S05

## Objetivo

No worker inbound, persistir os `InboundEvent` de Instagram (DM, story_mention, story_reply, share, postback, reaction, seen, referral, comment, mention) no schema já ready: upsert de contato (por IGSID), conversa (`kind` direct/story_thread/comment_thread), mensagens (`type` story_mention/comment/etc.), e linhas em `ig_comments`; idempotente; emite os mesmos sockets do LiveChat e métricas `hm.ig.messages.received{type}`.

## Contexto

`apps/workers/src/inbound/db-ports.ts` já tem `case 'meta_instagram'` (stub). O schema suporta todos os subtipos. Este slot implementa a persistência real para IG, reusando a pipeline inbound do WA (mesma fila/worker) — só o ramo IG.

## Escopo (faz)

- `apps/workers/src/inbound/**`: handler IG que mapeia cada `InboundEvent` IG → upsert contact (IGSID/username) + conversation (kind correto) + message (type correto) + `ig_comments` (para comments) sob RLS; dedup por remote id (uq existentes).
- Story media: enfileirar download em `hm.q.inbound.media` (alta prioridade — URL expira ~5min, INSTAGRAM.md §17) reusando o media worker.
- Sockets `message:new`/`conversation:updated` (LIVECHAT §6 — sem eventos novos, §13).
- Métricas OTel `hm.ig.messages.received{type}` (reusa o helper de observability dos workers, F10-S01).

## Fora de escopo

- Parsing (F15-S01), ingestão webhook (F15-S02), outbound (F15-S04), API de comments (F15-S05).

## Arquivos permitidos

- `apps/workers/src/inbound/**`

## Arquivos proibidos

- `apps/workers/src/outbound/**` (F15-S04), `apps/workers/src/observability/**` (reusar helpers, não editar)

## Definition of Done

- [ ] Cada subtipo IG persiste corretamente (contact por IGSID, conversation.kind, message.type, ig_comments); idempotente (reprocesso não duplica).
- [ ] Story media enfileirada p/ download imediato; comment thread cria conversation `comment_thread`.
- [ ] Caminho WhatsApp inbound **inalterado** (testes verdes).
- [ ] `pnpm --filter @hm/workers test` (IG inbound, db/http mockados) + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**.
- RLS: `ig_comments` já está em RLS_TABLES; persistir sob `withWorkspace`. PII (igsid/username) deve ser mascarada em logs (INSTAGRAM.md §15 — Pino redact).
