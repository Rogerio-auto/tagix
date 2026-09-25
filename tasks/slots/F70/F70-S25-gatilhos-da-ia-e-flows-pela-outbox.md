---
id: F70-S25
title: Gatilhos da IA e passos de flow pela outbox, lembrete da agenda com conversa real
phase: F70
status: available
priority: high
estimated_size: M
depends_on: [F70-S21]
blocks: [F70-S24]
source_docs:
  - tasks/slots/F70/F70-S21-ultimos-publicadores-pos-commit.md
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

## Escopo (faz)

- Cada gatilho acima grava o job de `hm.q.flows` com `queueJobOutbox` na transação que motiva o job. Acrescentar `flows` a `OUTBOX_JOB_QUEUES`.
- `enqueueStep` do flow-engine pela outbox, na transação da execução.
- `campaigns-inbound`: job pela outbox e com a mensagem real.
- Lembrete da agenda ao contato: resolve ou cria a conversa do contato no canal certo, grava a mensagem `pending` e o job na mesma transação (padrão da F70-S21 no LiveChat). Sem canal WhatsApp elegível, não envia e registra o motivo.
- Scheduler: recupera execução `running` parada além de um limite (configurável), sem executar duas vezes o mesmo passo.
- `coexistence` usa `inboundMediaJobOutbox`.

## Definition of Done

- [ ] teste por gatilho: rollback → nada na outbox; commit → um job em `hm.q.flows`
- [ ] teste: lembrete da agenda cria ou usa a conversa e é aceito pelo worker outbound (sem DLQ)
- [ ] teste: execução `running` parada é retomada uma vez
