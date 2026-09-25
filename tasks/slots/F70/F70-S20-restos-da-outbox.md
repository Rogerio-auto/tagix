---
id: F70-S20
title: Restos da outbox — envios da API v1, message.sent atômico, mídia da coexistência e emissor morto
phase: F70
status: in-progress
priority: medium
estimated_size: S
depends_on: [F70-S17, F70-S19]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S16-outbox-transacional.md
  - tasks/slots/F70/F70-S17-produtores-da-api-no-outbox.md
agent_id: backend-engineer
claimed_at: 2026-09-25T06:45:27Z

---
# F70-S20 — Restos da outbox

## Objetivo

Todo job e todo evento que nasce de uma escrita no banco sair pela outbox, sem exceção, e o código morto do emissor pós-commit sair do repositório.

## Contexto

Pendências da F70-S16 e da F70-S17:
- `send_message`, `send_template` e `send_media` da API v1 publicam o job de outbound depois do commit (`publishOutboundJob`). `queueJobOutbox` já suporta essa fila.
- `message.sent` (`outbound/finalize.ts`) grava o evento numa transação separada, porque a persistência do status mora em `outbound/db-ports.ts`.
- Os jobs de mídia da coexistência continuam publicados depois do commit.
- `mark_resolved` dá a `conversation.resolved` um id de ocorrência aleatório: reexecutar a tool na mesma execução grava um segundo evento. O `transfer_to_human` já amarra o id ao `executionId`.
- `emitDomainEvent`/`emitDomainEvents` ficaram sem nenhum chamador de produção.

## Escopo

### files_allowed

- `apps/api/src/routes/v1/**`
- `apps/api/src/internal/tools/workflow-handlers.ts`
- `apps/api/src/internal/tools/*.test.ts`
- `apps/workers/src/outbound/**`
- `apps/workers/src/coexistence/**`
- `apps/workers/src/webhooks/e2e.test.ts`
- `packages/shared/src/mq/**`
- `packages/shared/src/webhook-signature*.ts`
- `packages/shared/src/index.ts`
- `apps/workers/src/webhooks/signature*.ts`
- `apps/workers/src/webhooks/dispatcher.ts`
- `apps/api/src/routes/dev/webhooks.ts`
- `apps/api/src/routes/dev/*.test.ts`
- `apps/web/**/WebhooksManager.tsx`
- `docs/api-reference/guides/webhooks.mdx`

## Escopo (faz)

- Envios da API v1 pela outbox, na transação que grava a mensagem.
- A porta de persistência do outbound aceita os eventos: `message.sent` fica na mesma transação do status.
- Jobs de mídia da coexistência pela outbox.
- `mark_resolved`: `event_id` derivado do `executionId`, como o do handoff.
- **Assinatura única (pendência da F70-S19):** mover o signer/verificador de `apps/workers/src/webhooks/signature.ts` para `@hm/shared`; o ping de teste de Settings → Dev (`apps/api/src/routes/dev/webhooks.ts`) passa a assinar no formato novo (`x-hm-timestamp` + HMAC de `ts.body`); `docs/api-reference/guides/webhooks.mdx` e o texto do `WebhooksManager.tsx` descrevem o formato novo.
- Remover `emitDomainEvent`/`emitDomainEvents` e ajustar docs e testes que ainda os citam.

## Definition of Done

- [x] teste: rollback no envio v1 → nenhum job na outbox; commit → um job
  (`apps/api/src/routes/v1/outbox.integration.test.ts`, os três endpoints)
- [x] teste: `message.sent` some junto quando a gravação do status falha
  (`apps/workers/src/outbound/message-sent-atomic.test.ts`)
- [x] teste: `mark_resolved` repetido na mesma execução → um evento só
  (`apps/api/src/internal/tools/workflow-handlers.domain-events.test.ts`)
- [x] `git grep emitDomainEvent` sem resultado fora de `tasks/` (os slots antigos
  são histórico e ficam como estão)
- [x] teste: o ping de teste é aceito pelo verificador de referência; timestamp
  adulterado é recusado (`apps/api/src/routes/dev/routes.test.ts`)

## Decisões

### Envios da API v1

- `send_message`, `send_template` e `messages/media` gravam o `OutboundJob` com
  `queueJobOutbox(QUEUES.outbound, …)` dentro do `withWorkspace` que insere a mensagem
  `pending`. O envelope tem o mesmo tipo (`outbound.job`) e o mesmo payload de antes.
- A rota muda: antes `hm.events` com rk `hm.q.outbound.send`; agora o exchange padrão
  direto na fila `hm.q.outbound`, como campanhas e followups. O worker consome a fila,
  então nada muda para ele.
- `publishOutboundJob` continua em `apps/api/src/mq/outbound-publisher.ts` para o
  LiveChat (`conversations/messages.ts`) e as ações de comentário do Instagram, fora
  desta fronteira.

### `message.sent` atômico

- `PersistOutboundInput` ganhou `outbox?: readonly OutboxMessage[]`. O `finalize` monta o
  `message.sent` e o entrega junto do status `sent`. O `DbOutboundPersistence` grava status,
  bump da conversa e outbox num `withWorkspace` só.
- Saiu o `enqueueOutboxStandalone` do finalize, junto do parâmetro `writeOutbox`.
- O evento é gravado mesmo que a linha da mensagem não esteja visível (apagada entre o
  envio e o finalize): o provider aceitou o envio, e é isso que o evento afirma. É o
  mesmo comportamento de antes.
- Evento de outro workspace: a RLS `outbox_tenant_insert` recusa e o status volta junto
  (fail-closed, coberto por teste).
- `MqOutboundPersistence` (legada, só exportada) lança se receber eventos. Um publish não
  tem transação com o banco, e descartar em silêncio perderia o evento.
- **Trade-off:** o `external_id` agora commita junto do evento. Se a transação falhar, o
  retry não encontra o `external_id` e reenvia ao provider. Esse risco já existia para
  qualquer falha da gravação do status. O insert na outbox só aumenta um pouco a
  superfície, porque falha nos mesmos casos em que o UPDATE falharia (banco fora). A
  guarda `alreadySent` continua valendo para tudo que commitou.

### Mídia da coexistência

- Os jobs de download (`hm.q.media`) do eco do WhatsApp, do eco do Instagram e do
  histórico entram na outbox pela mesma transação que insere a mensagem, depois do
  `conversation.opened`. `inTxAnnouncingOpened` virou `inTxWithOutbox`: o resultado da
  transação declara `opened` e `mediaJobs`.
- `OUTBOX_JOB_QUEUES` passou a aceitar `QUEUES.media`. Não precisou de migração: o CHECK da
  0086 só restringe o exchange.
- O envelope do job leva o workspace real, não o `UNRESOLVED_WORKSPACE_ID` do inbound. A
  RLS de insert exige isso, e o media-worker ignora o campo (casa pela `externalId`).
- O tipo `inbound.media.requested` está repetido em `COEXISTENCE_MEDIA_JOB_TYPE` para não
  importar o grafo do worker inbound, que importa a coexistência. O teste fake da
  coexistência compara com `INBOUND_MEDIA_TYPE`.
- O construtor de `DbCoexistencePersistence` perdeu o parâmetro `media`, e a composição
  não cria mais `MqMediaEnqueue` para a coexistência. O inbound segue com o próprio
  enqueue, fora desta fronteira.

### `conversation.resolved` da IA

- `resolvedByAgent` passa `env.executionId` como ocorrência, e o `event_id` fica
  `<conversa>:resolved:<executionId>`. Vale para o `mark_resolved` e para o
  `change_conversation_status(resolved)`: resolver duas vezes na mesma execução grava um
  evento, e outra execução grava outro.

### Signer único

- `packages/shared/src/webhook-signature.ts` é exportado por `@hm/shared/mq`, porque
  importa `node:crypto`. O barrel raiz entra no bundle do browser e só ganhou um
  comentário, como o do `ssrf-guard`.
- A API pública do verificador não mudou: nomes, tipos e motivos de recusa são os mesmos.
- `apps/workers/src/webhooks/signature.ts` virou reexport. Continua existindo porque
  `webhooks/index.ts` e a `webhook-events.mdx` o referenciam.
- A entrega de teste (`buildTestDelivery`) tem a anatomia de uma entrega real:
  - headers `x-hm-event: webhook.test`, `x-hm-timestamp` e `x-hm-signature-256`;
  - corpo com `_meta` (`eventId` `webhook.test:<uuid>`, `occurredAt`).
  O corpo não leva mais o `workspaceId`, que nenhum evento real expõe.

### Emissor direto removido

- Saíram `emitDomainEvent`, `emitDomainEvents`, `publishDomainEvent`, o transporte
  substituível (`setDomainEventTransport`) e a conexão preguiçosa.
- Ficaram:
  - `setDomainEventLogger`, que loga o contrato violado em `domainEventsOutbox`;
  - `closeDomainEventEmitter`, como no-op `@deprecated`, porque
    `apps/workers/src/bootstrap/index.ts` ainda o chama no shutdown.
- O `e2e.test.ts` dos webhooks publica pelo caminho real: `enqueueOutbox` numa transação
  RLS, e um `OutboxRelay` escopado ao workspace do teste leva ao broker. O teste de dedup
  cobre dois casos:
  - a regravação do produtor, que dá `DO NOTHING`;
  - a republicação pelo relay, com a linha de volta a `pending` como numa queda antes de
    marcar `sent`. Continua uma entrega só.

## Riscos

- **Ping de teste:** mudou de formato. Um cliente que validava o ping pelo formato antigo
  (HMAC só do corpo, `event` no topo) passa a recusá-lo. Conhecidos: nenhum. É o mesmo
  corte já feito para os eventos reais na F70-S19.
- **Mensagens em voo no deploy:** jobs v1 e de mídia publicados pelo código antigo seguem
  válidos, porque o payload e o tipo não mudaram.

## Pendências fora da fronteira

- `docs/api-reference/guides/webhook-events.mdx`:
  - o `<Warning>` ainda diz que a seção "Verificar a assinatura" e a entrega de teste
    estão no formato antigo;
  - aponta `apps/workers/src/webhooks/signature.ts` como implementação de referência. O
    caminho vale, porque o arquivo é reexport, mas a fonte agora é
    `packages/shared/src/webhook-signature.ts`.
  Precisa de ajuste de texto.
- `apps/workers/src/bootstrap/index.ts`: tirar a chamada a `closeDomainEventEmitter` e
  depois a função. `setDomainEventLogger` continua.
- `@hm/db`: `enqueueOutboxStandalone` ficou sem uso de produção.
- `apps/workers/src/webhooks/index.ts` pode importar o signer direto de `@hm/shared/mq`.
- Restam publishes pós-commit fora desta fronteira:
  - `publishOutboundJob` no LiveChat (`conversations/messages.ts`) e nas ações de
    comentário do Instagram;
  - `flows/outbound-publisher.ts`, `agents/worker.ts` e `calendar-reminders`;
  - o `MqMediaEnqueue` do inbound.
  Candidatos a um próximo slot da outbox.

## Validação

O vitest de `@hm/workers` e o de `@hm/api` não carregam o `.env`. Sem o `--env-file`, os
testes de banco pulam.

```bash
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/webhook-signature.test.ts src/mq/domain-events.test.ts src/mq/outbox.test.ts --maxWorkers=2
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/v1/outbox.integration.test.ts src/routes/v1/routes.test.ts src/routes/dev/routes.test.ts src/internal/tools/workflow-handlers.domain-events.test.ts src/internal/tools/router.test.ts --maxWorkers=2
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/outbound src/coexistence src/webhooks src/inbound/origin-gate.test.ts --maxWorkers=2
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
```
