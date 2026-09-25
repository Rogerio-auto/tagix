---
id: F70-S21
title: Últimos publicadores pós-commit pela outbox e limpeza do emissor antigo
phase: F70
status: in-progress
priority: medium
estimated_size: M
depends_on: [F70-S20]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S20-restos-da-outbox.md
agent_id: backend-engineer
claimed_at: 2026-09-25T12:25:22Z

---
# F70-S21 — Últimos publicadores pós-commit pela outbox e limpeza do emissor antigo

## Objetivo

Nenhum job que nasce de uma escrita no banco ser publicado fora da transação, e nenhum resto do emissor antigo no código.

## Contexto

Pendências da F70-S20:
- Publicações depois do commit que restaram:
  - `publishOutboundJob` no LiveChat e nas ações de comentário do Instagram;
  - `flows/outbound-publisher`, `agents/worker`, `calendar-reminders`;
  - `MqMediaEnqueue` do inbound.
- `apps/workers/src/bootstrap/index.ts` ainda chama `closeDomainEventEmitter`, mantido como no-op deprecated só para compilar.
- `enqueueOutboxStandalone` (`@hm/db`) ficou sem chamador de produção.
- `docs/api-reference/guides/webhook-events.mdx` ainda tem um `<Warning>` dizendo que a verificação e o ping estão no formato antigo, o que não é mais verdade.

## Escopo

### files_allowed

- `apps/api/src/routes/conversations/**`
- `apps/api/src/routes/instagram/**`
- `apps/api/src/routes/ig-comments/**`
- `apps/api/src/services/**`
- `apps/workers/src/flows/**`
- `apps/workers/src/agents/**`
- `apps/workers/src/calendar-reminders/**`
- `apps/workers/src/inbound/**`
- `apps/workers/src/bootstrap/index.ts`
- `packages/flow-engine/src/**`
- `packages/shared/src/mq/**`
- `packages/db/src/outbox*.ts`
- `packages/db/src/index.ts`
- `docs/api-reference/guides/webhook-events.mdx`
- `apps/api/src/mq/outbound-publisher.ts` *(correção 2026-09-25: é onde `publishOutboundJob` mora; sai o publish direto e fica o construtor da mensagem da outbox)*
- `apps/api/src/routes/campaigns/builder/index.ts` *(correção: o envio de teste do criador de campanhas é o último chamador de `publishOutboundJob` na API — mensagem `pending` gravada numa transação, job publicado depois)*
- `apps/api/src/routes/campaigns/builder/routes.test.ts` *(correção: o teste injetava o `publishOutbound`, que deixa de existir)*
- `apps/api/src/routes/campaigns/builder/outbox.integration.test.ts` *(correção: rollback/commit do envio de teste)*
- `apps/workers/src/index.ts` *(correção: o barrel reexporta `MqMediaEnqueue` e `INBOUND_MEDIA_RK`, que saem)*

*(Antes de editar, listar no slot o arquivo exato de cada publicador, com o motivo, no padrão da F69-S03. Pasta fora desta lista exige nota de correção.)*

### Publicadores (inventário antes de editar, `git grep` em `c8ed9e63`)

Migram para a outbox (o job nasce de uma escrita no banco):

| Publicador | Arquivo:linha | Escrita que motiva o job |
| --- | --- | --- |
| Envio do LiveChat | `apps/api/src/routes/conversations/messages.ts:577` (`publishOutboundJob`) | mensagem `pending` + auto-pausa da IA, no `req.scoped` |
| Resposta pública/privada a comentário do IG | `apps/api/src/services/instagram/comment-actions.ts:166` | mensagem `pending` (`createPendingMessage`) |
| Ocultar comentário do IG | `apps/api/src/services/instagram/comment-actions.ts:139` | `ig_comments.hidden` |
| Envio de teste do criador de campanhas | `apps/api/src/routes/campaigns/builder/index.ts:494` *(correção)* | conversa + mensagem `pending` + auditoria em `prepareTestSend` |
| Definição do publish direto | `apps/api/src/mq/outbound-publisher.ts:43` *(correção)* | — (sai; fica `outboundJobOutbox`) |
| Envio de mensagem do flow | `apps/workers/src/flows/outbound-publisher.ts:65` (texto, mídia, interativo, template) | mensagem `pending` + `last_message_*` em `persistOutboundMessage` |
| Resposta do agente de IA | `apps/workers/src/agents/worker.ts:176` (`MqAgentOutboundEnqueue`) | mensagem `pending` do agente em `DbAgentRunStore.persistAgentMessage` |
| Lembrete de compromisso ao contato e ação de vencimento `send_message` | `apps/workers/src/calendar-reminders/reminders.ts:328` (`enqueueTemplate`, chamado em `:396` e `:440`) | `events.metadata.remindersSent` / `dueActionDone`, que antes eram gravados em outra transação, depois do publish |
| Download da mídia recebida | `apps/workers/src/inbound/mq-ports.ts:43` (`MqMediaEnqueue`, chamado em `inbound/pipeline.ts:169`) | mensagem inbound com `media_status = pending` em `DbInboundPersistence.persist` |

Ficam como estão (não nascem de uma escrita no banco, ou são outra família de fila):

- `flows/outbound-publisher.ts` — `publishPresence` (`typing_indicator`): só lê o alvo da última inbound, não grava nada, e o indicador é efêmero. Gravar na outbox tornaria durável algo que perde o sentido em segundos.
- Relay de socket (`hm.q.socket.relay`) em `flows/`, `agents/worker.ts:117`, `calendar-reminders/reminders.ts:255`, `inbound/db-ports.ts:188`, `inbound/status.ts:562` e nas rotas da API: notificação em tempo real, sem garantia por desenho; a tela reconcilia pelo refetch.
- `agents/followup.ts:302`: o tick relê o estado e marca no Redis, sem escrita no banco.
- `flows/scheduler.ts:152`: o tick relê `flow_executions` vencidas e republica; não grava.
- `packages/shared/src/mq/dlq.ts` e `retry.ts`: republicam uma mensagem já consumida.
- Fila `hm.q.flows` (gatilho de turno da IA): `inbound/db-ports.ts:291` (`MqInboundFlowEnqueue`), `agents/reengagement.ts:481`, `apps/api/src/routes/conversations/agent.ts:110`, `apps/api/src/internal/tools/agent-transfer-handlers.ts:103`. Nascem de escrita, mas não estão na lista desta spec: exigem `QUEUES.flows` em `OUTBOX_JOB_QUEUES` e rever a agregação do agente. Ficam para um próximo slot (ver Pendências).
- Passo de flow (`hm.q.flow.execution`) do `flow-engine` (`triggerFlow` → `queue.enqueueStep`, inclusive a ação `trigger_flow` do lembrete): a porta de banco da engine não compartilha transação com a porta de fila. Próximo slot.
- `apps/workers/src/campaigns-inbound/db-ports.ts:104` (confirmação de descadastro) e `:196` (followup `on_reply`): fora da lista da spec e com contrato de porta próprio. Próximo slot.

## Escopo (faz)

- Cada publicador acima grava o job com `queueJobOutbox` na transação que grava o dado que motiva o job.
- Remover `closeDomainEventEmitter` e a chamada no bootstrap.
- Remover `enqueueOutboxStandalone`, se continuar sem uso.
- Corrigir o `<Warning>` de `webhook-events.mdx`.

## Definition of Done

- [ ] teste por publicador: rollback → nenhum job na outbox; commit → um job
- [ ] `git grep` sem `closeDomainEventEmitter` e sem `publishOutboundJob` fora de testes (ou justificativa por chamada restante)
- [ ] doc sem o aviso obsoleto
