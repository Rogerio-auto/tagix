---
id: F70-S13
title: conversation.opened em todos os caminhos de criação e handoff de campanha honesto
phase: F70
status: available
priority: medium
estimated_size: S
depends_on: [F70-S09]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S09-ligar-os-webhooks-de-saida.md
  - tasks/slots/F70/F70-S08-defesa-em-profundidade-da-trava-da-ia.md
---
# F70-S13 — conversation.opened em todos os caminhos de criação e handoff de campanha honesto

## Objetivo

Todo sistema assinante saber de toda conversa nova, venha de onde vier, e o resultado do handoff de campanha refletir o que de fato aconteceu com a IA.

## Contexto

- F70-S09: `conversation.opened` só sai do inbound e da reabertura manual. Lead ads (`apps/workers/src/leadgen/db-store.ts`), coexistência (`apps/workers/src/coexistence/db-ports.ts`) e campanhas (`apps/workers/src/campaigns/db-ports.ts`) também criam conversa e não publicam.
- F70-S08: `processCampaignInbound` devolve `handedOff: true` mesmo quando a trava de origem recusa, porque o contrato do port é `Promise<void>`.

## Escopo

### files_allowed

- `apps/workers/src/leadgen/**`
- `apps/workers/src/coexistence/**`
- `apps/workers/src/campaigns/**`
- `apps/workers/src/campaigns-inbound/**`
- `apps/workers/src/inbound/ai-gate.ts`
- `apps/workers/src/inbound/*.test.ts`

## Escopo (faz)

- Publicar `conversation.opened` depois do commit em cada caminho de criação, com o `emitDomainEvent` e o construtor do catálogo da S09 (mesmo `eventId` canônico, sem PII além do contrato).
- O contrato do handoff de campanha devolve se aplicou; `handedOff` reflete a recusa.

## Definition of Done

- [ ] teste por caminho: conversa criada → evento publicado uma vez, depois do commit; rollback → nenhum evento
- [ ] teste: trava recusa → `handedOff: false`
