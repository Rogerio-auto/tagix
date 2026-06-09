---
id: F1-S07
title: Worker outbound — composition + per-chat lock + provider routing
phase: F1
status: blocked
priority: critical
estimated_size: L
depends_on: [F1-S05, F1-S08, F1-S09]
---

# F1-S07 — Worker outbound

> **source_docs:** `docs/features/LIVECHAT.md` §3 (composition, union, lock, presence)
> **blocks:** F1-S17, F1-S20, F1-S21

## Objetivo
Consumir `hm.q.outbound.request`: parse (Zod `OutboundJob` union) → per-chat FIFO lock (Redis 90s) → dispatch (valida `kind ↔ provider`) → process (adapter) → finalize (persist + update last + socket emit).

## Escopo (faz)
- `apps/workers/src/outbound/**` — consumer + `parse/dispatch/process/finalize` + `runWithDistributedLock` (Redis) + validação de coerência kind↔provider (rejeita mismatch antes da borda Meta).

## Arquivos permitidos
- `apps/workers/src/outbound/**`, `apps/workers/src/lock.ts`, `apps/workers/src/index.ts`

## Definition of Done
- [ ] Envio text/media/template/interactive roteado ao adapter correto; mismatch → erro tipado.
- [ ] Lock garante ordem FIFO por conversa.
- [ ] Persist + `message:status_changed` socket; typecheck + lint + test.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
Janela 24h e message_tag entram em F1-S17 (front+regra). Presence (typing) em F1-S21.
