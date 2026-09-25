---
id: F70-S13
title: conversation.opened em todos os caminhos de criação e handoff de campanha honesto
phase: F70
status: review
priority: medium
estimated_size: S
depends_on: [F70-S09]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S09-ligar-os-webhooks-de-saida.md
  - tasks/slots/F70/F70-S08-defesa-em-profundidade-da-trava-da-ia.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:23:34Z
completed_at: 2026-09-25T04:42:40Z

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

- [x] teste por caminho: conversa criada → evento publicado uma vez, depois do commit; rollback → nenhum evento
- [x] teste: trava recusa → `handedOff: false`

## Validação

```bash
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/leadgen src/coexistence src/campaigns src/campaigns-inbound src/inbound/origin-gate.test.ts --maxWorkers=2
pnpm --filter @hm/workers typecheck
```

## Resumo

- **Onde publica `conversation.opened`** (depois do commit, construtor do catálogo, eventId
  `<conversa>:opened`): lead ads (`DbLeadStore.persist`), eco do app WhatsApp/Instagram e
  importação de histórico (`DbCoexistencePersistence`), disparo de campanha
  (`enqueueDelivery`). Só quem inseriu a conversa anuncia; reentrega, reprocesso e o perdedor
  de corrida não; rollback não anuncia. Emissor injetável (default `emitDomainEvent`).
- **Handoff honesto:** `handoffToAgent` devolve `{ applied }` (port DB e `gateCampaignAiHandoff`);
  `processCampaignInbound` usa isso em `handedOff`.
- **Correções no caminho:** campanha cria a conversa por upsert `(channel_id, remote_id)` (antes a
  UNIQUE derrubava o disparo numa corrida com o inbound); coexistência repete o predicado do
  índice parcial `uq_contacts_workspace_phone` no ON CONFLICT (antes todo contato novo por eco
  ou histórico falhava com 42P10).
- **Testes:** DB real para os três caminhos (publica uma vez, conversa já visível por outra
  conexão no instante da publicação, rollback forçado não publica) + recusa da trava →
  `handedOff: false`.
- **Pendências:** `trigger` do contrato só aceita `inbound | reopened` (`@hm/shared`, fora do
  escopo): os três caminhos novos saem como `inbound`; ampliar o enum (`lead_ad`, `app_echo`,
  `history`, `campaign`) mantendo o eventId. Leadgen também cria mensagem inbound e card sem
  `message.received`/`deal.created`. Campanha publica o job de outbound DENTRO da transação
  (pré-existente). Conversa criada por campanha nasce sem `origin` — a trava recusa o handoff
  dela (agora visível em `handedOff`).
