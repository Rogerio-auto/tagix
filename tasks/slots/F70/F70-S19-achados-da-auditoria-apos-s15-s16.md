---
id: F70-S19
title: Achados da auditoria que dependem da S15 e da S16 — IA legada, eco, assinatura com timestamp e consumer estrito
phase: F70
status: in-progress
priority: high
estimated_size: S
depends_on: [F70-S15, F70-S16]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S18-achados-baixos-da-auditoria.md
agent_id: backend-engineer
claimed_at: 2026-09-25T06:21:59Z

---
# F70-S19 — Achados da auditoria que dependem da S15 e da S16

## Objetivo

Fechar M2, L3, L5, L6 e L7 da auditoria pré-deploy de 25/09.

## Escopo

### files_allowed

- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/*.test.ts`
- `apps/workers/src/coexistence/worker.ts`
- `apps/workers/src/webhooks/**`
- `packages/shared/src/mq/domain-events.ts`
- `packages/shared/src/mq/*.test.ts`
- `docs/api-reference/guides/webhook-events.mdx`
- `packages/db/drizzle/**` *(se precisar marcar "ligado por humano")*
- `packages/db/src/schema/conversations.ts`
- `apps/api/src/routes/conversations/state.ts`
- `apps/api/src/routes/conversations/agent.ts`

## Escopo (faz)

- **M2:** o worker de agentes só responde se a origem for elegível **ou** se a IA foi ligada por um humano (marca explícita gravada por `state.ts`/`agent.ts`). Conversas antigas `on` sem origem param de receber IA automática até um humano religar. Runbook: a consulta de pré-deploy que lista essas conversas.
- **L3:** `warn` no boot dos workers quando `META_APP_ID` estiver vazio.
- **L5:** header `x-hm-timestamp`, assinatura de `ts.body`, e documentação da janela de replay.
- **L6:** teto de tamanho no texto livre de `message.received`/`message.sent`.
- **L7:** o consumer revalida `data` com `DOMAIN_EVENT_DATA_SCHEMAS[event]` estrito; o que não bate vai para a DLQ.

## Definition of Done

- [ ] teste: conversa `on` legada sem origem e sem marca humana → o worker não responde; ligada por humano → responde
- [ ] teste: assinatura com timestamp verificada; replay fora da janela recusado pelo verificador de referência
- [ ] teste: payload fora do contrato vai para a DLQ
