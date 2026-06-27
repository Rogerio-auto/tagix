---
id: F52-S10
title: Lock distribuído Redis para outbound (ordem multi-instância) + tuning
phase: F52
status: blocked
priority: medium
estimated_size: M
depends_on: [F52-S04]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
---
# F52-S10 — Lock distribuído + tuning de performance

> **Origem:** survey desta sessão. `apps/workers/src/lock.ts` é in-memory (FIFO por processo); com múltiplas instâncias de worker a ordem das mensagens da mesma conversa não é garantida.

## Objetivo

Garantir ordenação FIFO por conversa no envio outbound mesmo com múltiplas instâncias de worker, via lock distribuído em Redis, e aplicar tuning de performance para alto volume.

## Contexto / causa raiz (confirmada)

`apps/workers/src/lock.ts:15-19` documenta que para múltiplas instâncias seria preciso um `LockStore` baseado em Redis — **não implementado** (`ioredis` não está no `package.json` de `apps/workers`). Com 2+ workers, mensagens da mesma conversa podem sair fora de ordem.

## Escopo (faz)

- **`RedisLockStore`** implementando a interface `LockStore` existente, com lock por chave de conversa, TTL e renovação segura (evitar liberar lock de outro dono — token/Lua).
- Adicionar `ioredis` ao `apps/workers/package.json`; cliente Redis em `apps/workers/src/redis/**`.
- **Injetar** o store no worker outbound (`apps/workers/src/outbound/worker.ts`): usar Redis em produção (multi-instância), fallback in-memory em dev/teste (configurável por env).
- **Tuning:** revisar prefetch do outbound, evitar consultas repetidas (cache de canal/adapter por workspace), reduzir round-trips por job. Documentar os ganhos.

## Fora de escopo

- Lógica de idempotência/status (F52-S04 — este slot assume outbound já estável).
- Lock no inbound/flows.
- DLX/retry (F52-S03).

## Arquivos permitidos

- `apps/workers/src/lock.ts`
- `apps/workers/src/outbound/worker.ts`
- `apps/workers/src/redis/**`
- `apps/workers/package.json`

## Arquivos proibidos

- `apps/workers/src/outbound/dispatch.ts` · `apps/workers/src/outbound/finalize.ts` · `apps/workers/src/outbound/db-ports.ts` (todos F52-S04) · `apps/api/**`

## Definition of Done

- [ ] `RedisLockStore` garante exclusão mútua por conversa entre processos (teste com 2 "instâncias" contra Redis dev).
- [ ] Lock tem TTL e só é liberado pelo dono (token); crash não trava a conversa para sempre.
- [ ] Worker outbound usa Redis em prod, in-memory em teste — sem regressão de ordem na suíte existente.
- [ ] Tuning aplicado e medido (prefetch/cache de adapter); documentado nas notas do PR.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Redis já está na stack (Socket.io adapter, rate-limit, locks de scheduler) — reusar o mesmo broker/URL.
- Padrão de lock: SET NX PX + token aleatório + release via script Lua (compare-and-delete). Não usar DEL cego.
- Depende de F52-S04 só para sequenciar a área outbound (S04 estabiliza idempotência/status antes de mexer no consumer loop); arquivos são disjuntos.
