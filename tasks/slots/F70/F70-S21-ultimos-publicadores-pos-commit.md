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

*(Antes de editar, listar no slot o arquivo exato de cada publicador, com o motivo, no padrão da F69-S03. Pasta fora desta lista exige nota de correção.)*

## Escopo (faz)

- Cada publicador acima grava o job com `queueJobOutbox` na transação que grava o dado que motiva o job.
- Remover `closeDomainEventEmitter` e a chamada no bootstrap.
- Remover `enqueueOutboxStandalone`, se continuar sem uso.
- Corrigir o `<Warning>` de `webhook-events.mdx`.

## Definition of Done

- [ ] teste por publicador: rollback → nenhum job na outbox; commit → um job
- [ ] `git grep` sem `closeDomainEventEmitter` e sem `publishOutboundJob` fora de testes (ou justificativa por chamada restante)
- [ ] doc sem o aviso obsoleto
