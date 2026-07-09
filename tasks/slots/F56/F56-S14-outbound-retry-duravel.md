---
id: F56-S14
title: Outbound — retry durável para falha transitória do provider
phase: F56
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S14 — Outbound: retry durável de transitório (INF-02)

> **Origem:** AUDITORIA_TECNICA.md §3.2. O adapter WhatsApp captura todo erro (inclusive `MetaError{retryable:true}`) e retorna `{ok:false}`; `finalize` persiste `failed` e ack'a — a ladder durável nunca dispara para 429/5xx/timeout.

## Objetivo

Reprocessar envios que falharam por erro transitório do provider, mantendo `failed` apenas para erros de conteúdo permanentes.

## Contexto / causa raiz (verificada)

`packages/channels/src/meta/whatsapp/adapter.ts:214-226` descarta o flag `retryable` em `toSendResult`; `apps/workers/src/outbound/finalize.ts:49-68` persiste `failed` e ack'a. O guard `findSentExternalId` já evita duplicação no reenvio.

## Escopo (faz)

- Propagar erro retryable como exceção (ex. `RetryableSendError`) quando `MetaError.retryable && httpStatus ∈ {0,429,5xx}` → deixar a ladder (5s→30s→2m→10m→30m) reprocessar.
- Manter `failed` para erros permanentes (número inválido, 131xxx).

## Escopo (não faz)

- Lock/tuning outbound (F52-S10, já feito). MQ reliableQueues (F56-S12).

## Arquivos permitidos

- `apps/workers/src/outbound/**`
- `packages/channels/src/meta/whatsapp/adapter.ts`

## Arquivos proibidos

- `apps/workers/src/agents/**` · `apps/workers/src/campaigns/**`

## Definition of Done

- [ ] 429/5xx/timeout da Meta reprocessa via ladder (teste); não vira `failed` imediato.
- [ ] Erro permanente segue `failed` visível ao usuário.
- [ ] Sem duplicação no reenvio (guard `findSentExternalId`).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- `packages/channels` é consumido também pelo inbound; não alterar a assinatura pública do adapter além do necessário para expor `retryable`.
