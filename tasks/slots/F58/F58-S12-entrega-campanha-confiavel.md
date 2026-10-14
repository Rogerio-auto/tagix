---
id: F58-S12
title: Garantir que nenhuma mensagem da campanha se perca
phase: F58
status: done
priority: critical
estimated_size: L
depends_on: [F58-S02, F58-S11]
blocks: [F58-S13]
agent_id: backend-engineer
source_docs:
  - docs/ARCHITECTURE.md
  - docs/features/CAMPAIGNS.md
  - docs/runbooks/incident-rabbitmq-backlog.md
claimed_at: 2026-10-07T18:05:04Z
completed_at: 2026-10-07T18:31:17Z

---
# F58-S12 — Garantir que nenhuma mensagem da campanha se perca

## Objetivo

Remover a janela entre commit no Postgres e publish no RabbitMQ. Um recipient só
pode avançar quando existe trabalho durável para envio, e o resultado final do
outbound precisa voltar para a delivery/campanha.

## Escopo

### files_allowed

- `packages/db/src/schema/campaigns.ts`
- `packages/db/drizzle/0095_f58_campaign_outbox.sql` _(correção de fronteira: o 0069 planejado já estava em uso; a próxima livre era 0095)_
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

- [x] Dispatch grava delivery, mensagem, avanço do recipient e outbox na mesma transação. _(já era assim desde a F70-S16; agora também com as variáveis resolvidas do contato — teste "disparo grava delivery, mensagem, avanço e job JUNTOS")_
- [x] Publisher drena outbox com claim atômico, publisher confirm/backpressure, retry e DLQ observável. _(reuso do relay da F70-S16: `FOR UPDATE SKIP LOCKED`, confirms+mandatory, backoff, `dead` com log error; `awaitDrainIfNeeded` deixou de pendurar para sempre com canal fechado)_
- [x] Crash antes/depois do publish não perde mensagem nem envia duplicata lógica. _(testes: queda antes do COMMIT; relay que publica e cai antes de marcar → 2 cópias no transporte, 1 envio ao provider; restart do relay não republica)_
- [x] Sucesso/falha permanente do outbound atualiza `campaign_deliveries` diretamente, sem depender de webhook.
- [x] Erro de template pausado/rejeitado interrompe novos envios e aparece na campanha. _(catálogo antes do disparo + código da Meta no envio → `campaign.paused` com motivo/orientação, lido pela API como `statusReason`)_
- [x] Bindings são renderizados por destinatário antes do outbound, com fallback obrigatório e sem compartilhar valores entre contatos.
- [~] Componentes de botão preservam `sub_type` e `index` até o adapter do canal. _(chegam ao `SendTemplateInput` do adapter; o serializer WA — fora da fronteira — ainda os descarta: ver "Em aberto")_
- [~] Pausar/cancelar impede outbox ainda não publicada; jobs já entregues ao broker ficam quantificados na resposta. _(retenção/descarte/quantificação no banco, para qualquer autor da mudança de status; a RESPOSTA HTTP é da rota da API — fora da fronteira: ver "Em aberto")_
- [x] Migration tem RLS/índices e testes de restart, concorrência e broker indisponível. _(sem tabela nova de tenant → nenhuma policy nova; função SECURITY DEFINER presa ao workspace da campanha; índice parcial novo)_

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/shared test
pnpm --filter @hm/workers test
python scripts/slot.py check-migrations
```

## Notas

- `persistent: true` em canal AMQP comum não substitui publisher confirms nem outbox transacional.

## Execução (2026-10-07)

### Decisão: reusar a outbox da F70-S16, não criar `campaign_outbox`

A outbox transacional genérica (0086/0091) já entrega o que o DoD pede do publisher
(claim atômico, confirms, retry, `dead` observável, comportamento com broker fora, testes),
e o disparo de campanha já gravava o job nela na transação da delivery. Uma segunda tabela
duplicaria esse relay e exigiria um segundo loop no composition root (`bootstrap`/
`campaigns/index.ts`, fora da fronteira). A única lacuna real — pausa/cancelamento não
segurava job ainda não publicado — foi fechada NO BANCO: o trigger
`trg_campaign_outbox_gate` (AFTER UPDATE OF status em `campaigns`) retém
(`available_at = infinity`), libera ou descarta os jobs `hm.q.outbound` da campanha na
mesma transação do UPDATE. Vale para qualquer autor (API, auto-pausa do tick, pausa por
modelo no outbound) e não tem janela: o UPDATE espera a linha que o relay está publicando
e reavalia. Correlação job → delivery pelo `messageId` do payload (sem campo novo no
envelope; funciona para jobs já na fila antes do deploy).

### Entrega

- `0095_f58_campaign_outbox.sql`: índice parcial `idx_campaign_deliveries_message`;
  função `campaign_outbox_gate()` (SECURITY DEFINER, `search_path` fixo, EXECUTE revogado
  de PUBLIC, fixa `app.workspace_id` = workspace da campanha e restaura no fim) + trigger.
  Auditoria `campaign.outbox_gated` `{ transition, held|released|dropped, inFlight }`.
  Cancelar marca delivery `failed campaign_cancelled` e a mensagem `failed`.
- `campaigns/outbox/bindings.ts`: contrato `binding_contract/v1` → componentes da Graph por
  destinatário (fallback obrigatório, normalização de quebra de linha/tab/4+ espaços,
  conferência contra o modelo sincronizado; legado validado e repassado).
- `campaigns/outbox/template-gate.ts`: catálogo (PAUSED/DISABLED/REJECTED/indisponível) e
  códigos da Meta do MODELO (132000/132001/132007/132012/132015/132016) → motivo de pausa +
  orientação em linguagem de produto.
- `campaigns/outbox/outcome.ts`: desfecho do outbound → delivery (reusa
  `propagateStatusToCampaignDelivery` para sucesso; falha grava código/mensagem), pausa por
  modelo, recipient com passos restantes sai da sequência em falha do contato.
- `campaigns/db-ports.ts`: disparo consulta o catálogo e renderiza antes de gravar; modelo
  bloqueado → rollback + pausa com motivo + `gate_closed not_running`.
- `outbound/db-ports.ts`: `applyCampaignDeliveryOutcome` na transação do status.
- `outbound/job.ts` + `channels/types.ts`: `sub_type`/`index` preservados (opcionais: o nó
  `template` do Flow Builder ainda não os produz e recusar mandaria job para a DLQ).
- `shared/mq/publish.ts`: `awaitDrainIfNeeded` corre contra `close` (`MqChannelClosedError`)
  e remove ouvintes em qualquer desfecho.

### Validação

- Migration aplicada no Postgres local (`pnpm --filter @hm/db migrate`) e conferida no
  catálogo: trigger `trg_campaign_outbox_gate` habilitado, função `prosecdef = true` com
  `search_path=pg_catalog, public`, índice `idx_campaign_deliveries_message` presente.
- `pnpm typecheck` verde (todos os projetos); eslint limpo nos arquivos tocados.
- `@hm/workers` 88 arquivos / 929 testes verdes (2 skipped, pré-existentes) — inclui
  `campaigns/delivery-reliability.db.test.ts` (8 cenários contra Postgres real) e
  `campaigns/outbox/bindings.test.ts` (14).
- `@hm/db` 283, `@hm/shared` 249 (+3 novos de backpressure), `@hm/channels` 336, API
  `routes/campaigns` 140 — todos verdes.
- Concorrência medida em 4 rodadas (12 disparos × pausa no meio): 11/1, 12/0, 2/10, 6/6
  enfileirados/recusados — em todas, 100% dos jobs commitados ficaram retidos.
- `python scripts/slot.py check-migrations` OK.

### Em aberto (fora da fronteira deste slot)

1. **Serializer WhatsApp** (`packages/channels/src/meta/whatsapp/serializer.ts`,
   `serializeTemplateComponent`) copia só `type` + `parameters`: `sub_type`/`index` chegam
   ao adapter e são descartados na montagem do JSON da Graph. Botão com variável continua
   recusado pela Meta até essa linha mudar (2 campos). Precisa de sub-slot.
2. **Resposta da pausa/cancelamento** (`apps/api/src/routes/campaigns/lifecycle.ts` e o
   `DELETE` de `crud.ts`): o número já existe na mesma transação do UPDATE (audit
   `campaign.outbox_gated`, `inFlight`/`held`/`dropped`); falta a rota ler e devolver.
3. Contrato `binding_contract/v1` duplicado entre `apps/api` (criação/prévia) e
   `apps/workers` (envio). O teste do worker trava o formato; o lugar certo é `@hm/shared`.
