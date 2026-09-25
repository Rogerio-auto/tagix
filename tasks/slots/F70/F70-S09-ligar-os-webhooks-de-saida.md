---
id: F70-S09
title: Ligar os webhooks de saída
phase: F70
status: available
priority: high
estimated_size: S
depends_on: [F70-S01]
blocks: []
source_docs:
  - rogerio-os/tasks/central-operacao/CO-21-ligar-os-webhooks-de-saida-do-leadium.md
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
