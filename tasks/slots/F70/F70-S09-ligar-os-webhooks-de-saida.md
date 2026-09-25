---
id: F70-S09
title: Ligar os webhooks de saída
phase: F70
status: in-progress
priority: high
estimated_size: S
depends_on: [F70-S01]
blocks: []
source_docs:
  - rogerio-os/tasks/central-operacao/CO-21-ligar-os-webhooks-de-saida-do-leadium.md
agent_id: backend-engineer
claimed_at: 2026-09-25T03:57:10Z

---
# F70-S09 — Ligar os webhooks de saída

> Espelho do **CO-21** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

O Leadium avisar outros sistemas (o Rogério OS em primeiro lugar) quando algo acontece.

## Contexto

`fanoutEvent` (`apps/workers/src/webhooks/fanout.ts`) nunca é chamado: falta o consumer de `hm.events`. Os webhooks de saída nunca disparam (só o `/test`).

## Escopo

### files_allowed

- `apps/workers/src/webhooks/**`
- `apps/workers/src/bootstrap/index.ts`
- `packages/shared/src/mq/**`
- pontos que publicam em `hm.events`: listados aqui, com o motivo, antes de editar (nota de correção no padrão da F69-S03)
- `apps/api/src/routes/dev/webhooks.ts` *(correção 2026-09-25: o catálogo `WEBHOOK_EVENTS` passa a derivar do catálogo único `DOMAIN_EVENTS` de `@hm/shared/mq`, que ganha `conversation.handoff` — sem isso ninguém consegue assinar o evento novo)*
- `apps/api/src/internal/tools/registry.ts` *(correção: `ToolHandlerResult.events` — as tools da IA declaram os eventos de domínio como dado, e o router os publica depois do commit)*
- `apps/api/src/internal/tools/router.ts` *(correção: publica `result.events` só depois do commit da transação RLS; evento de rollback nunca sai)*
- `apps/api/src/internal/tools/workflow-handlers.ts` *(correção: `conversation.handoff` em `transfer_to_human`; `conversation.resolved` em `mark_resolved`/`change_conversation_status`; `conversion.registered` em `register_conversion`; `deal.stage_changed` em `move_deal_stage`)*
- `apps/api/src/internal/tools/workflow-handlers.domain-events.test.ts` *(correção: teste dos eventos declarados pelas tools, sem PII no handoff)*
- `apps/api/src/routes/conversations/state.ts` *(correção: `conversation.resolved` e `conversation.opened` na reabertura manual, pós-commit)*
- `apps/api/src/routes/deals/crud.ts` *(correção: `deal.created`, `deal.stage_changed`, `deal.won`, `deal.lost` pós-commit; os testes de `routes/deals` NÃO são tocados — outro agente)*
- `apps/api/src/routes/v1/index.ts` *(correção: `deal.stage_changed` e `conversion.registered` pela API pública)*
- `apps/api/src/routes/conversions/events.ts` *(correção: `conversion.registered` no registro manual)*
- `apps/workers/src/inbound/db-ports.ts` *(correção: `message.received` e `conversation.opened` depois do commit da persistência inbound)*
- `apps/workers/src/outbound/finalize.ts` *(correção: `message.sent` — está no catálogo e hoje nunca dispara, mesmo defeito deste slot)*
- `docs/api-reference/guides/webhook-events.mdx` *(correção: catálogo público com `conversation.handoff` e o formato de cada evento)*

## Escopo (faz)

- Consumer de `hm.events` → `fanoutEvent` no bootstrap dos workers.
- Garantir a publicação em `hm.events` de `message.received`, `conversation.opened`, `conversation.resolved`, `deal.*`, `conversion.registered` e de um evento novo `conversation.handoff` (a IA pediu humano).
- Testes de ponta a ponta com o dispatcher e a assinatura `x-hm-signature-256`.

## Fora de escopo

- Consumidores do lado do Rogério OS (CO-22).

## Definition of Done

- [ ] evento real entregue num receptor de teste (local)
- [ ] retentativa e dedup testadas
- [ ] assinatura `x-hm-signature-256` verificada no teste
