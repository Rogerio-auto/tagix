---
id: F52-S02
title: Webhook à prova de perda (dedup pós-enqueue + backpressure + redelivery counter)
phase: F52
status: done
priority: critical
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
completed_at: 2026-06-27T03:13:25Z

---
# F52-S02 — Webhook à prova de perda de evento

> **Origem:** survey desta sessão. Fragilidade CRÍTICA #1 do mapeamento inbound.

## Objetivo

Garantir que **nenhum evento de webhook (Meta/WAHA) seja perdido** quando o enqueue no RabbitMQ falha ou aplica backpressure, eliminando a janela em que o dedup bloqueia a reentrega de um evento que nunca foi enfileirado.

## Contexto / causa raiz (confirmada)

Em `apps/api/src/routes/webhooks/meta.ts:188-195` o `registerWebhookEvent` grava o evento em `webhook_events` (dedup) **antes** de confirmar o `publishInboundMessage`. Se o publish lança ou retorna `false` (buffer cheio), o webhook responde erro, a Meta reentrega, mas o dedup já marcou → **evento perdido permanentemente**. O retorno booleano de backpressure (`publisher.ts:57`) é ignorado e não há try-catch. WAHA (`waha.ts:75`) herda o mesmo defeito.

## Escopo (faz)

- **Inverter a ordem / tornar atômico:** só marcar dedup (`webhook_events`) **após** o enqueue ser confirmado com sucesso. Se o publish falhar/retornar `false`, **não** registrar dedup e responder com status que faça a Meta reentregar (5xx), garantindo nova chance.
- **Checar o retorno booleano** de `publishInboundMessage` e tratar backpressure (`false`) como falha de enqueue (não responder 200 cego).
- **Try-catch** em torno do publish em `meta.ts` e `waha.ts`; log estruturado com o event-id.
- **Contador de reentrega:** incrementar métrica/log quando o dedup detecta um evento já visto (visibilidade de quantas reentregas a Meta faz).
- Garantir que a resposta ao provider continue dentro do SLA (< ~5s) — o publish deve ter timeout curto (ver Notas) para não pendurar a requisição.

## Fora de escopo

- Implementar DLX/DLQ dos consumers (é F52-S03).
- Mudar o worker inbound.
- Mudar o schema de `webhook_events`.

## Arquivos permitidos

- `apps/api/src/routes/webhooks/meta.ts`
- `apps/api/src/routes/webhooks/waha.ts`
- `apps/api/src/routes/webhooks/publisher.ts`
- `apps/api/src/routes/webhooks/dedup.ts`

## Arquivos proibidos

- `apps/workers/**` · `packages/shared/src/mq/**` (F52-S03) · `packages/db/**`

## Contratos

- Resposta 200 ao provider **somente** quando: assinatura válida **E** (evento duplicado já processado **OU** enqueue confirmado **E** dedup registrado).
- Falha de enqueue → 5xx (provider reentrega) e dedup **não** registrado.

## Definition of Done

- [ ] Teste: publish que lança → webhook responde 5xx **e** `webhook_events` NÃO contém o evento (reentrega possível).
- [ ] Teste: publish que retorna `false` (backpressure) → tratado como falha (5xx, sem dedup).
- [ ] Teste: evento duplicado (já em `webhook_events`) → 200 sem republicar + contador de reentrega incrementa.
- [ ] Caminho feliz preservado: assinatura válida + publish ok → 200 + dedup registrado + 1 publish.
- [ ] `pnpm typecheck` + `pnpm lint` + testes da rota verdes.

## Permission scope

Endpoint público (webhook), autenticado por assinatura HMAC. Não muda authz; mantém `verifyMetaSignature` intacto.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- A assinatura HMAC deve continuar sendo verificada **antes** de qualquer trabalho (já é).
- Cuidado com o SLA da Meta: se o broker estiver down, prefira falhar rápido (timeout curto no `getHandle()`/publish) e responder 5xx — a Meta reentrega — em vez de pendurar a requisição até o timeout dela.
- Idempotência de processamento downstream já existe (`uq_messages_external`), então uma reentrega extra é segura.
