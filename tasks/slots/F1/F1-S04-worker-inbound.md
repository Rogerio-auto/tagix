---
id: F1-S04
title: Worker inbound — parser por provider + persist + relay
phase: F1
status: in-progress
priority: critical
estimated_size: L
depends_on: [F1-S02, F1-S05, F1-S09]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:44:21Z

---
# F1-S04 — Worker inbound

> **source_docs:** `docs/features/LIVECHAT.md` §1 (10 passos), §5.1
> **blocks:** F1-S10, F1-S11

## Objetivo
Consumir `hm.q.inbound.message`, parsear por provider (Meta WA implementado; Meta IG placeholder logged-warn; WAHA implementado), e executar o pipeline: dedup → ensure contact → ensure conversation → persist messages → update last → enqueue media → bump cache → publish socket relay → (se ai_mode='on') enqueue agent/flow.

## Escopo (faz)
- `apps/workers/src/inbound/**` — consumer + pipeline (10 passos do LIVECHAT §1), usando adapter.parseInbound, repos (@hm/db), mq (@hm/shared/mq), storage enqueue.

## Arquivos permitidos
- `apps/workers/src/inbound/**`, `apps/workers/src/index.ts`

## Definition of Done
- [ ] Mensagem WA inbound vira contact+conversation+message persistidos (escopo workspace via RLS).
- [ ] Dedup respeitado; mídia enfileirada em `hm.q.inbound.media`.
- [ ] Publica `socket.relay` com `message:new`.
- [ ] IG → logged-warn (placeholder); typecheck + lint + teste de integração do pipeline (WA).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
`apps/workers` ainda é skeleton — este slot adiciona o runtime real do worker inbound (amqp consume + handlers).
