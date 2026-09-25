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

- [x] teste por publicador: rollback → nenhum job na outbox; commit → um job
- [x] `git grep` sem `closeDomainEventEmitter` e sem `publishOutboundJob` fora de testes (ou justificativa por chamada restante)
- [x] doc sem o aviso obsoleto

## Decisões

### API

- `apps/api/src/mq/outbound-publisher.ts` não publica mais. Ficam `OUTBOUND_JOB_TYPE`,
  `outboundJobOutbox(workspaceId, job)` e `enqueueOutboundJob(tx, workspaceId, job)`.
  Saíram `publishOutboundJob`, a conexão AMQP própria e `closeOutboundPublisher`, que não
  tinha chamador.
- A rota muda como na F70-S20: antes `hm.events` com rk `hm.q.outbound.send`; agora o
  exchange padrão direto em `hm.q.outbound`. Mesmo tipo e mesmo payload.
- **LiveChat** (`POST /api/conversations/:id/messages`): o job é gravado dentro do
  `req.scoped` que insere a mensagem `pending` e aplica a auto-pausa da IA. O replay
  idempotente (`Idempotency-Key`) devolve antes do insert e não grava job.
- **Comentários do IG:**
  - resposta: mensagem `pending` e job numa transação só (`createPendingReply`);
  - ocultar: `hidden` e job numa transação só. Sem conversa associada, o `hidden`
    continua gravado e a rota responde 409, como antes. Nenhum job sai, porque o worker
    precisa da conversa.
- **Teste do criador de campanhas** *(correção)*: `prepareTestSend` grava o job antes de
  devolver `created`. A opção `publishOutbound` do router saiu. O teste unitário passou a
  ler o insert na outbox pela transação falsa. Como o envelope exige workspace uuid, o
  bloco do envio de teste usa um.

### Workers

- **Flows:** `OutboundPersistencePort.persistOutboundMessage(input, buildJob)` recebe o
  construtor do job. O `messageId` só existe depois do INSERT, e o job é montado dentro
  da transação. `publishJob` virou `publishPresenceJob`, usado só pelo `typing_indicator`.
- **Agente:** `PersistAgentMessageInput` ganhou `channelId` e `chatId`.
  `DbAgentRunStore.persistAgentMessage` grava a mensagem e o job `text`. Saíram
  `AgentRunDeps.outbound`, `AgentOutboundEnqueuePort`, `AgentOutboundEnqueueInput` e
  `MqAgentOutboundEnqueue`. `OUTBOUND_JOB_TYPE` passou a morar em `run.ts`: o
  `worker.ts` o reexporta, porque `run.ts` não pode importar valor de `worker.ts` sem
  ciclo.
- **Lembretes da agenda:**
  - o job nasce da marca de idempotência, não de uma linha nova;
  - a transação reivindica a marca com um UPDATE condicional (`remindersSent` sem o
    offset; `dueActionDone` diferente de `true`) e só então grava o job;
  - quem não reivindica não envia. O lembrete ao contato devolve `false`; a ação devolve
    `skipped` com `already_done`;
  - `markReminded` e `markDueActionDone` continuam depois e são idempotentes.
- **Bug corrigido na marca do tick** (achado pelo teste real): `withRemindersSent`
  interpolava o array JS (`${offsets}::int[]`). O Drizzle expande array em lista de
  parâmetros, e o driver recusava o número num parâmetro `int[]`. A marca nunca era
  gravada, e o tick falhava no `markReminded`. Os unitários usam portas stub e não
  pegavam. Agora os offsets vão como um parâmetro jsonb.
- **Mídia do inbound:**
  - o job vai na transação de `DbInboundPersistence.persist`, depois dos eventos de
    domínio, um por mensagem NOVA com `mediaRef`. A mensagem deduplicada não regrava,
    porque o job já entrou com a primeira inserção;
  - `PersistInboundResult` ganhou `mediaJobs`, e o pipeline só repassa a contagem;
  - saíram `InboundDeps.media`, `MediaEnqueuePort`, `MqMediaEnqueue` e
    `INBOUND_MEDIA_RK`; entrou `inboundMediaJobOutbox`;
  - o envelope leva o workspace real, porque a RLS exige. O media-worker não usa o
    campo;
  - o construtor duplica o de `coexistence/db-ports.ts` (`mediaJobOutbox`), fora da
    fronteira. A igualdade do tipo continua travada pelo teste da coexistência.

### Limpeza

- Saíram `closeDomainEventEmitter` (`@hm/shared/mq`) e a chamada no shutdown do bootstrap.
- Saiu `enqueueOutboxStandalone` (`@hm/db`), sem chamador.
- `webhook-events.mdx`: o `<Warning>` mantém o aviso da troca de formato. Tirou-se a
  frase que dizia que a verificação e o ping estavam no formato antigo. A referência
  aponta `packages/shared/src/webhook-signature.ts`.
- Três arquivos foram formatados inteiros pelo Prettier, que já apontava diferenças
  antes deste slot: `flows/outbound-publisher.ts`, o teste dele e o teste de integração
  novo. Nos demais arquivos tocados, as diferenças do Prettier já existiam e ficaram.

### `git grep` final

- `publishOutboundJob`, `closeDomainEventEmitter`, `enqueueOutboxStandalone` e
  `MqAgentOutboundEnqueue`: nenhuma ocorrência fora de `tasks/`.
- `MqMediaEnqueue`: só em comentários de `apps/workers/src/media/job.ts:4` e
  `media/media.test.ts:150`, fora da fronteira. O shape que eles descrevem não mudou.

## Riscos

- **Lembrete da agenda ao contato continua quebrado (anterior a este slot):** o job leva
  `conversationId: ''` e um `messageId` sintético sem linha em `messages`.
  `parseOutboundJob` recusa `conversationId` vazio, então o job vai para a DLQ, agora
  pela outbox. O caminho transacional está pronto; o payload precisa de conversa e
  mensagem `pending` reais. Fica para um slot da agenda.
- **Mensagens em voo no deploy:** os jobs publicados pelo código antigo seguem válidos,
  porque o tipo e o payload não mudaram. A mídia antiga chega com workspace
  `UNRESOLVED`, e o media-worker ignora o campo.
- **Latência:** o job sai quando o relay acorda (LISTEN/NOTIFY no commit, polling de 1s
  de segurança), não no mesmo tick. É o mesmo custo já aceito para campanhas e para a
  API v1.

## Pendências fora da fronteira

- **Gatilhos da IA em `hm.q.flows`**, que nascem de escrita:
  - `inbound/db-ports.ts:291`;
  - `agents/reengagement.ts:481`;
  - `apps/api/src/routes/conversations/agent.ts:110`;
  - `apps/api/src/internal/tools/agent-transfer-handlers.ts:103`.
  Exigem `QUEUES.flows` em `OUTBOX_JOB_QUEUES` e rever o buffer de agregação do agente.
- **Passo de flow** (`hm.q.flow.execution`): `triggerFlow` grava a execução por uma porta
  e publica o passo por outra. Uma execução `running` cujo publish se perde não é
  reanimada: o scheduler só varre `waiting`.
- **`campaigns-inbound/db-ports.ts`:** a confirmação de descadastro (`:104`, com
  `messageId` sintético, como a agenda) e o followup `on_reply` (`:196`).
- **Comentários obsoletos em `media/`:** `media/job.ts:4` e `media/media.test.ts:150`
  ainda citam `MqMediaEnqueue`.
- **`coexistence/db-ports.ts`:** pode usar `inboundMediaJobOutbox` e apagar a cópia
  `mediaJobOutbox` e `COEXISTENCE_MEDIA_JOB_TYPE`, se o ciclo de import permitir.

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq/outbox.test.ts src/mq/domain-events.test.ts --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/conversations/messages.outbox.integration.test.ts src/routes/conversations/messages.test.ts src/routes/conversations/messages.idempotency.test.ts src/routes/conversations/__tests__/cycle-timestamps.integration.test.ts --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/instagram src/routes/campaigns/builder/routes.test.ts src/routes/campaigns/builder/outbox.integration.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/flows/outbound-publisher.outbox.test.ts src/flows/outbound-publisher.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents/persist-agent-message.outbox.test.ts src/agents/agents.test.ts src/agents/run.test.ts src/agents/run-origin-gate.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/calendar-reminders --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound/media-outbox.test.ts src/inbound/inbound.test.ts src/inbound/revocation.test.ts src/inbound/origin-gate.test.ts src/media/media.test.ts src/coexistence/coexistence.test.ts --maxWorkers=1
```

## Resumo

- **API:** o LiveChat, as ações de comentário do IG e o envio de teste do criador de
  campanhas gravam o job de envio na outbox, na transação do dado.
  `publishOutboundJob` saiu.
- **Workers:** entram na outbox, na transação do dado:
  - o envio do flow;
  - a resposta do agente;
  - o lembrete ao contato e a ação `send_message` da agenda, junto da marca de
    idempotência;
  - o job de mídia do inbound.
  A presença dos flows segue com publish direto.
- **Limpeza:** saíram `closeDomainEventEmitter` e `enqueueOutboxStandalone`, e o aviso
  obsoleto da doc.
- **Bug corrigido:** a marca `remindersSent` do tick da agenda nunca era gravada.
- **Testes novos contra o Postgres de dev** (commit, rollback e casos de borda):
  - LiveChat: 4;
  - IG: 7;
  - teste de campanha: 3;
  - flows: 4;
  - agente: 2;
  - agenda: 5;
  - mídia do inbound: 4.
