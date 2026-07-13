---
id: F56-S16
title: Socket relay — emitir antes de bumpar + prefetch + patch incremental
phase: F56
status: done
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-13T14:26:51Z

---
# F56-S16 — Relay de socket confiável (INF-09/INF-11/INF-13, PERF-04/05)

> **Origem:** AUDITORIA_TECNICA.md §3.2/§3.7. O relay faz `await bumpVersion(Redis)` antes do emit; um blip de Redis derruba o `message:new`. Sem prefetch (unbounded). Log de diagnóstico em todo emit. Invalidação workspace-wide causa cache stampede.

## Objetivo

Tornar a entrega de eventos em tempo real robusta a blips de Redis e reduzir o fanout/log no caminho quente.

## Contexto / causa raiz (verificada)

`apps/api/src/socket/relay.ts:84-104` — bump antes do emit dentro do try; `:96-99` loga `relay emit` com contagem de salas por evento; sem `channel.prefetch`.

## Escopo (faz)

- Emitir primeiro, bumpar depois (best-effort com try/catch interno) — nunca deixar o bump derrubar o emit.
- `channel.prefetch(~100)` no consumer do relay.
- Rebaixar o log `relay emit` para `debug` (gated).
- Onde viável, favorecer patch incremental do item da ChatList em vez de invalidação workspace-wide (reduz stampede) — ou coalescer o bump.

## Escopo (não faz)

- Reconnect/reliableQueues (F56-S12). Virtualização/memo do frontend (follow-up de performance).

## Arquivos permitidos

- `apps/api/src/socket/relay.ts`

## Arquivos proibidos

- `apps/api/src/socket/index.ts` · `apps/api/src/sockets/**`

## Definition of Done

- [ ] Falha de `bumpVersion` não impede o `emit` (teste).
- [ ] Consumer do relay com prefetch definido.
- [ ] Log por-emit em `debug`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- O patch incremental completo pode ser follow-up; o mínimo aqui é ordem emit-antes-de-bump + prefetch + log.
