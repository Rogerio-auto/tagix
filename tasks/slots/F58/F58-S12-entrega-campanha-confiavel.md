---
id: F58-S12
title: Garantir que nenhuma mensagem da campanha se perca
phase: F58
status: available
priority: critical
estimated_size: L
depends_on: [F58-S02, F58-S11]
blocks: [F58-S13]
agent_id: backend-engineer
source_docs:
  - docs/ARCHITECTURE.md
  - docs/features/CAMPAIGNS.md
  - docs/runbooks/incident-rabbitmq-backlog.md
---

# F58-S12 — Garantir que nenhuma mensagem da campanha se perca

## Objetivo

Remover a janela entre commit no Postgres e publish no RabbitMQ. Um recipient só
pode avançar quando existe trabalho durável para envio, e o resultado final do
outbound precisa voltar para a delivery/campanha.

## Escopo

### files_allowed

- `packages/db/src/schema/campaigns.ts`
- `packages/db/drizzle/0069_f58_campaign_outbox.sql`
- `packages/db/drizzle/meta/_journal.json`
- `apps/workers/src/campaigns/outbox/**`
- `apps/workers/src/campaigns/db-ports.ts`
- `apps/workers/src/campaigns/**/*test.ts`
- `apps/workers/src/outbound/finalize.ts`
- `apps/workers/src/outbound/db-ports.ts`
- `apps/workers/src/outbound/job.ts`
- `apps/workers/src/outbound/**/*test.ts`
- `packages/channels/src/types.ts`
- `packages/shared/src/mq/publish.ts`
- `packages/shared/src/mq/reliability.test.ts`

### files_forbidden

- `apps/web/**`
- `packages/db/drizzle/meta/*_snapshot.json`

## Definition of Done

- [ ] Dispatch grava delivery, mensagem, avanço do recipient e outbox na mesma transação.
- [ ] Publisher drena outbox com claim atômico, publisher confirm/backpressure, retry e DLQ observável.
- [ ] Crash antes/depois do publish não perde mensagem nem envia duplicata lógica.
- [ ] Sucesso/falha permanente do outbound atualiza `campaign_deliveries` diretamente, sem depender de webhook.
- [ ] Erro de template pausado/rejeitado interrompe novos envios e aparece na campanha.
- [ ] Bindings são renderizados por destinatário antes do outbound, com fallback obrigatório e sem compartilhar valores entre contatos.
- [ ] Componentes de botão preservam `sub_type` e `index` até o adapter do canal.
- [ ] Pausar/cancelar impede outbox ainda não publicada; jobs já entregues ao broker ficam quantificados na resposta.
- [ ] Migration tem RLS/índices e testes de restart, concorrência e broker indisponível.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/shared test
pnpm --filter @hm/workers test
python scripts/slot.py check-migrations
```

## Notas

- `persistent: true` em canal AMQP comum não substitui publisher confirms nem outbox transacional.
