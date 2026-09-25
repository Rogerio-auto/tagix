---
id: F70-S25
title: Gatilhos da IA e passos de flow pela outbox, lembrete da agenda com conversa real
phase: F70
status: done
priority: high
estimated_size: M
depends_on: [F70-S21]
blocks: [F70-S24]
source_docs:
  - tasks/slots/F70/F70-S21-ultimos-publicadores-pos-commit.md
agent_id: backend-engineer
claimed_at: 2026-09-25T13:20:25Z
completed_at: 2026-09-25T14:09:45Z

---
# F70-S25 — Gatilhos da IA e passos de flow pela outbox, lembrete da agenda com conversa real

## Objetivo

Nenhuma mensagem de cliente ficar sem resposta da IA, e nenhum passo de flow se perder, porque o processo caiu entre o commit e a publicação. E o lembrete da agenda ao contato chegar de fato.

## Contexto

Pendências da F70-S21:
- Gatilhos da IA em `hm.q.flows` publicados depois do commit: `apps/workers/src/inbound/db-ports.ts:291`, `apps/workers/src/agents/reengagement.ts:481`, `apps/api/src/routes/conversations/agent.ts:110`, `apps/api/src/internal/tools/agent-transfer-handlers.ts:103`.
- O passo de flow do `flow-engine` (`enqueueStep`).
- `apps/workers/src/campaigns-inbound/db-ports.ts:104` e `:196`. O `:104` usa um `messageId` inexistente.
- **Bug:** o lembrete WhatsApp da agenda ao contato vai com `conversationId: ''` e um `messageId` inexistente. O worker outbound recusa e o job vai para a DLQ.
- Execução de flow em `running` cuja publicação se perdeu não é recuperada: o scheduler só olha `waiting`.
- `coexistence/db-ports.ts` tem uma cópia do construtor do job de mídia; deve usar `inboundMediaJobOutbox`.

## Escopo

### files_allowed

- `apps/workers/src/inbound/**`
- `apps/workers/src/agents/**`
- `apps/workers/src/flows/**`
- `apps/workers/src/campaigns-inbound/**`
- `apps/workers/src/calendar-reminders/**`
- `apps/workers/src/coexistence/**`
- `apps/workers/src/media/**`
- `apps/api/src/routes/conversations/agent.ts`
- `apps/api/src/routes/conversations/*.test.ts`
- `apps/api/src/internal/tools/agent-transfer-handlers.ts`
- `apps/api/src/internal/tools/*.test.ts`
- `packages/flow-engine/src/**`
- `packages/shared/src/mq/**`
- `apps/api/src/routes/flows/engine.ts` *(correção 2026-09-25: o passo de flow passa a ser gravado pelo port de banco da engine, na transação da execução; o `FlowQueuePort` sai do contrato e a engine da API deixa de injetar um publisher próprio)*
- `apps/workers/src/index.ts` *(correção: o barrel reexporta `MqInboundFlowEnqueue`, `InboundFlowEnqueuePort`, `INBOUND_FLOW_TYPE` e `FLOWS_QUEUE`, que saem ou mudam)*
- `apps/workers/src/bootstrap/index.ts` *(correção: follow-up e reengajamento da IA deixam de receber o canal AMQP, e a engine de flows deixa de receber o publisher de passos)*
- `packages/db/drizzle/0090_f70_flow_running_recovery.sql`, `packages/db/drizzle/meta/_journal.json`, `packages/db/src/schema/flows.ts` *(correção: índice parcial das execuções `running` para a recuperação do scheduler, que varre todos os workspaces a cada tick)*
- `docs/api-reference/guides/webhook-events.mdx` *(correção: `conversation.opened` ganha o `trigger` `calendar_reminder`, quando o lembrete da agenda cria a conversa)*

## Escopo (faz)

- Cada gatilho acima grava o job de `hm.q.flows` com `queueJobOutbox` na transação que motiva o job. Acrescentar `flows` a `OUTBOX_JOB_QUEUES`.
- `enqueueStep` do flow-engine pela outbox, na transação da execução.
- `campaigns-inbound`: job pela outbox e com a mensagem real.
- Lembrete da agenda ao contato: resolve ou cria a conversa do contato no canal certo, grava a mensagem `pending` e o job na mesma transação (padrão da F70-S21 no LiveChat). Sem canal WhatsApp elegível, não envia e registra o motivo.
- Scheduler: recupera execução `running` parada além de um limite (configurável), sem executar duas vezes o mesmo passo.
- `coexistence` usa `inboundMediaJobOutbox`.

## Definition of Done

- [x] teste por gatilho: rollback → nada na outbox; commit → um job em `hm.q.flows`
- [x] teste: lembrete da agenda cria ou usa a conversa e é aceito pelo worker outbound (sem DLQ)
- [x] teste: execução `running` parada é retomada uma vez

## Decisões

### Contratos novos em `@hm/shared/mq`

- `agent-run.ts`: `AGENT_RUN_REQUESTED_TYPE` (`flow.run.requested`), `agentRunRequestedPayloadSchema`
  (uuid, estrito) e `agentRunJobOutbox(workspaceId, payload)`. Os cinco produtores usam o mesmo
  construtor; payload fora do contrato lança e derruba a transação que o motiva. O consumidor
  (`agents/worker.ts`) segue tolerante, para não descartar envelopes antigos em voo.
- `flows.ts`: `flowExecutionStepOutbox(workspaceId, executionId)`. O job vai direto na fila
  `hm.q.flow.execution` pelo exchange padrão; o consumidor lê o mesmo payload.
- `OUTBOX_JOB_QUEUES` ganhou `flows`, `flowExecution` e `campaigns`.
- `CONVERSATION_OPENED_TRIGGERS` ganhou `calendar_reminder` (doc do webhook atualizada).

### Gatilhos da IA (`hm.q.flows`), cada um na transação que o motiva

| Produtor | Transação |
| --- | --- |
| inbound (`inbound/db-ports.ts`) | a que insere a mensagem do contato. Só mensagem nova e só com a IA `on` lida no início da transação. Saíram `InboundFlowEnqueuePort`, `MqInboundFlowEnqueue` e o parâmetro `flow` de `DbInboundPersistence`. |
| reengajamento (`agents/reengagement.ts`) | a do UPDATE condicional que retoma a IA (trava de origem da F70-S08/S23 intacta). |
| follow-up (`agents/followup.ts`) | uma por workspace, a que lê as elegíveis. Não estava na lista; é o mesmo gatilho e publicava sem confirmação. |
| troca manual (`api/routes/conversations/agent.ts`) | o `req.scoped` do UPDATE que liga a IA. O socket continua depois do commit, best-effort. |
| `transfer_to_agent` (`api/internal/tools/agent-transfer-handlers.ts`) | a tx da tool. O `reengage` injetável passou a receber a `tx`. |

- **Trava de origem:** nada mudou em quem pode ligar a IA. Os UPDATEs condicionais são os mesmos
  e o worker ainda confere origem elegível ou marca humana (`authorizeAiReply`). Os testes de trava
  existentes rodam verdes (`run-origin-gate`, `reengagement-origin-gate`,
  `reengagement-human-mark`, `inbound/origin-gate`, `agent-transfer-origin-gate`). O teste novo
  do inbound prova que conversa `off` e conversa criada agora não geram gatilho.
- **Marca Redis x rollback:** reengajamento e follow-up gravam a marca de idempotência antes do
  UPDATE/outbox. Se a transação do workspace falhar, as marcas gravadas nela são desfeitas
  (DEL, best-effort), e o tick seguinte tenta a mesma janela. Antes a janela era perdida.
- `ReengagementDeps` e `FollowupDeps` perderam `channel` (bootstrap ajustado).
- **Buffer de agregação:** revisto. Nada o alimenta em produção (nenhum `add`), e o flush chama
  `runAgent` com o contexto durável do Redis, não com envelope. A troca de publicação não o afeta.

### Passo de flow (`hm.q.flow.execution`)

- O `FlowQueuePort` saiu do contrato da engine. Quem grava o passo é o port de banco, na transação
  da transição:
  - `createExecution` grava a execução `running` e o primeiro passo;
  - `patchExecution(..., { enqueueStep: true })` grava o próximo passo só se a transição aplicou.
    O avanço (`processing → running`) e a retomada (`waiting → running`) usam isso. Patch recusado
    pelo fencing não ressuscita a execução;
  - `go_to_flow` grava o passo do filho na transação que cria o filho. O dispatcher não
    reenfileira o filho (só limpa os marcadores e loga).
- **Bug corrigido de carona:** a engine default de `@hm/flow-engine` usava um sink em memória como
  fila. Os chamadores dela (`flows-triggers/db-ports.ts`: triggers e retomada do inbound;
  `api/routes/v1`: `trigger_flow`) criavam execuções que nunca recebiam passo. Agora gravam de
  verdade. `api/routes/flows/engine.ts` e o `reminders.ts` deixaram de injetar publisher.
- O wakeup de `waiting` vencida continua com publish direto: ele republica a cada tick até alguém
  reivindicar, e o claim absorve a duplicata.

### Recuperação de `running` parada (scheduler de flows)

- Mesmo tick do wakeup, mesmo lock Redis. `recoverStaleRunning(config, limit)` roda numa
  transação do papel dos workers (cross-tenant, como `selectDue`):
  - **reivindicação:** CTE `FOR UPDATE SKIP LOCKED` + `UPDATE ... SET updated_at = now()` cujo
    WHERE repete `status = 'running'` e `coalesce(updated_at, started_at) <= now() - limite`.
    O passo entra na outbox na mesma transação. Duas instâncias: uma pula a linha travada pela
    outra; quem relê depois do commit já a vê fresca. A rodada seguinte só reanima de novo depois
    de outro limite inteiro;
  - **passo único:** o job reanimado passa pelo claim atômico do consumer (F56-S13). Se o envelope
    original só estava atrasado, um roda o passo e o outro perde (`in_flight`) ou encontra a
    execução adiante — nunca o mesmo nó duas vezes (provado com `flow_logs` no teste);
  - **velha demais:** parada além da idade máxima vira `failed` com `last_error` e log `error`,
    sem job. Mandar hoje a mensagem de um flow disparado há dias é pior que não mandar. Isso cobre
    as execuções que o bug da engine default deixou paradas em produção.
- Configuração: `FLOW_RUNNING_STALE_MS` (default 5 min, piso 1 min) e `FLOW_RUNNING_MAX_AGE_MS`
  (default 24 h, nunca abaixo do limite). Teto de 200 por tick.
- `updated_at` nasce NULL na criação, por isso o relógio é `coalesce(updated_at, started_at)`.
- Migração **0090**: índice parcial `idx_flow_executions_running_since` em
  `(coalesce(updated_at, started_at)) WHERE status = 'running'`. Sem ele a varredura por minuto era
  seq scan numa tabela que só cresce. O plano usa o índice (conferido com `EXPLAIN`). Criado na
  transação da migração (o migrator não aceita `CONCURRENTLY`): o build trava escrita em
  `flow_executions` pelo tempo de ler a tabela uma vez. Reverter:
  `DROP INDEX IF EXISTS idx_flow_executions_running_since;`.

### Lembrete da agenda ao contato (`calendar-reminders/contact-conversation.ts`)

- Na transação que reivindica a marca (`remindersSent` ou `dueActionDone`):
  1. resolve a conversa WhatsApp do contato, nesta ordem:
     - a do evento (`events.conversation_id`), se é do contato e o canal é WhatsApp Cloud ativo
       (e, se a ação fixa um canal, esse canal);
     - o canal da ação `send_message` ou o WhatsApp default ativo e, nele, a conversa mais recente
       do contato, depois a do par (canal, telefone);
     - sem nenhuma, cria (upsert no índice único canal + `remote_id`, como inbound e campanhas);
  2. grava a mensagem `pending` (`template`, remetente `system`);
  3. grava o job com conversa e mensagem reais e, se criou a conversa, o `conversation.opened`
     (`trigger: calendar_reminder`).
- `chatId` é o `remote_id` da conversa (o id do provider), não o telefone cadastrado.
- **IA na conversa criada: `ai_mode = 'off'`, `origin = 'sem-origem'`.**
  - Nada comprova de onde o contato veio: ele está na agenda da empresa, não chegou por anúncio,
    site ou Direct.
  - `origem:prospeccao` marca a conversa que o dono conduz pelo app; o lembrete é automático.
  - `sem-origem` é o valor fail-closed explícito: nenhum caminho automático liga a IA nela, e o
    worker de agentes não responde sem a marca humana. Se o contato responder, o inbound acha a
    conversa pronta e não reclassifica. Um humano liga a IA à mão se quiser.
  - Conversa existente: nenhuma coluna de IA ou origem é tocada.
  - O contato não ganha a etiqueta `sem-origem`: ela é do contato inteiro, e ele pode ter origem
    comprovada em outra conversa.
- **Sem WhatsApp elegível ou sem telefone para abrir conversa:** a marca é gravada, nada é enviado,
  e o motivo fica em `audit_logs` (`event.reminder.contact_skipped` com `reason`
  `no_whatsapp_channel`/`no_phone`; na ação de vencimento, `event.due_action.skipped`) e em log
  `warn`. Uma vez só, porque vai com a marca.

### campaigns-inbound

- `optOutContact(message, reason)` faz o opt-out e grava a confirmação (mensagem `pending` real +
  job) numa transação. Saiu `sendOptOutConfirmation`, e o `messageId: 'opt-out-confirm'`.
- `markRecipientResponded(ws, recipient, onReplyFollowup)` grava o followup `on_reply` em
  `hm.q.campaigns` com a marca de resposta. Saiu `publishFollowup`.
- `CampaignInboundDbDeps.channel` saiu.

### Coexistência e mídia

- `coexistence/db-ports.ts` usa `inboundMediaJobOutbox` de `inbound/mq-ports.ts` (sem ciclo:
  o módulo só importa `@hm/shared/mq` e tipos). Saíram `mediaJobOutbox` e
  `COEXISTENCE_MEDIA_JOB_TYPE`.
- Comentários de `media/job.ts` e `media/media.test.ts` apontam o construtor atual.

## Riscos

- **Entrega pelo menos uma vez:** um gatilho republicado pelo relay (queda antes do COMMIT da
  marca `sent`) roda um turno da IA duas vezes. É a mesma semântica da ladder de retry de hoje;
  o `runAgent` não deduplica por envelope.
- **Duas cadeias de passos:** se a recuperação reanima uma execução cujo envelope só estava
  atrasado (fila congestionada por mais que o limite), a execução avança com dois envelopes
  vivos até a próxima espera ou o fim. Nenhum nó roda duas vezes; o custo é throughput.
- **Primeiro tick depois do deploy:** execuções `running` herdadas do bug da engine default com
  menos de 24 h são reanimadas e rodam; as mais velhas viram `failed`. Conferir o volume em
  produção antes (`select count(*) ... where status = 'running' group by idade`).
- **Latência:** gatilho e passo saem quando o relay acorda (NOTIFY no commit, polling de 1 s).

## Pendências fora da fronteira

- `FLOW_RUNNING_STALE_MS` e `FLOW_RUNNING_MAX_AGE_MS` no compose de produção e no
  `.env.production.example` (a F70-S24 mexe no mesmo bloco).
- F70-S24: o CHECK de `routing_key` precisa aceitar as filas novas de `OUTBOX_JOB_QUEUES`
  (`hm.q.flows`, `hm.q.flow.execution`, `hm.q.campaigns`).
- `runAgent` idempotente por envelope (ou por `triggerExternalId`), para a duplicata do "pelo
  menos uma vez" não virar resposta dupla.
- O publish direto do wakeup de `waiting` poderia ir pela outbox para ganhar confirms; hoje o
  próximo tick cobre a perda.

## Validação

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/flow-engine typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq --maxWorkers=1
node --env-file=.env packages/flow-engine/node_modules/vitest/vitest.mjs run --root packages/flow-engine --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/conversations/agent.test.ts src/routes/conversations/agent.outbox.integration.test.ts src/internal/tools src/routes/flows src/routes/v1/cross-tenant.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound src/campaigns-inbound --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/flows src/flows-triggers src/calendar-reminders src/coexistence src/media --maxWorkers=1
```

## Resumo

- **Gatilhos da IA pela outbox, na transação do dado:** inbound, reengajamento, follow-up, troca
  manual de agente e `transfer_to_agent`, com um construtor só (`agentRunJobOutbox`).
- **Passo de flow pela outbox:** criação, avanço, retomada e flow filho, pelo port de banco da
  engine. O `FlowQueuePort` saiu. Corrigido de carona: triggers do inbound e `trigger_flow` da API
  v1 nunca publicavam o passo.
- **Recuperação de `running` parada:** reivindicação por UPDATE condicional + passo na outbox na
  mesma transação; expira as velhas demais. Índice parcial na 0090.
- **Lembrete da agenda:** conversa real (usa a do evento, a do contato ou cria `off` +
  `sem-origem`), mensagem `pending` e job na transação da marca; sem WhatsApp, marca + motivo
  auditado. O worker outbound aceita e envia (teste com as portas reais de banco).
- **campaigns-inbound:** confirmação de opt-out com mensagem real; followup `on_reply` com a marca.
- **Coexistência:** usa `inboundMediaJobOutbox`.
- **Testes (Postgres dev, commit e rollback forçado):**
  - novos contra o banco: inbound 4, reengajamento 2, follow-up 2, troca de agente 2,
    `transfer_to_agent` 3, port de flows + `go_to_flow` 8, recuperação 3, campaigns-inbound 5;
  - novos sem banco: construtores 7, scheduler 4, follow-up (marca desfeita) 1;
  - agenda: o teste da F70-S21 foi reescrito (5 casos viraram 10);
  - `slot.py validate` (suítes das pastas tocadas, uma por vez, `--maxWorkers=1`): shared/mq 51
    (+1 skip), flow-engine 111, API 141, workers inbound + campaigns-inbound 79, agents 101,
    flows + flows-triggers + agenda + coexistência + mídia 157. Todas verdes.
