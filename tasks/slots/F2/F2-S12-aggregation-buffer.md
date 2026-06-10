---
id: F2-S12
title: Aggregation buffer (window_sec) antes de chamar o runtime
phase: F2
status: blocked
priority: medium
estimated_size: S
depends_on: [F2-S11]
---

# F2-S12 — Buffer de agregação de mensagens

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §10; `docs/ROADMAP.md` F2-S12
> **blocks:** —

## Objetivo
Evitar disparar o agente a cada mensagem fragmentada do cliente: agrupa mensagens inbound da mesma conversa numa janela (`window_sec`) e só então chama o runtime com o lote — reduz custo e melhora a coerência da resposta.

## Escopo (faz)
- `apps/workers/src/agents/buffer.ts`: buffer por conversa com debounce/janela (Redis ou in-memory + TTL), `enqueueOrExtend(conversationId, message)` e flush ao expirar → entrega o lote ao runner (F2-S11).

## Fora de escopo
- A chamada ao runtime (F2-S11), follow-up (F2-S21).

## Arquivos permitidos
- `apps/workers/src/agents/buffer.ts`

## Definition of Done
- [ ] Mensagens da mesma conversa dentro da janela são agrupadas num único run.
- [ ] Janela configurável (`window_sec` por policy/agent); flush idempotente.
- [ ] `pnpm --filter @hm/workers typecheck`/lint/test verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
Preferir Redis (multi-instância) com lock/TTL; o lock FIFO de F1-S07 é referência de padrão.
