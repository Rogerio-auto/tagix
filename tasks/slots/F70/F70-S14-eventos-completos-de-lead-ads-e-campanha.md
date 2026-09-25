---
id: F70-S14
title: Origem real no conversation.opened, eventos de lead ads e outbound da campanha depois do commit
phase: F70
status: in-progress
priority: medium
estimated_size: S
depends_on: [F70-S13]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S13-conversation-opened-em-todos-os-caminhos.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:44:19Z

---
# F70-S14 — Origem real no conversation.opened, eventos de lead ads e outbound da campanha depois do commit

## Objetivo

Os eventos dizerem a verdade sobre como a conversa nasceu, lead ads avisarem tudo o que criam, e nenhuma mensagem de campanha ser enviada por uma transação que não aconteceu.

## Contexto

Pendências da F70-S13:
- `conversation.opened.trigger` só aceita `inbound | reopened`: eco do app, histórico, campanha e lead ads saem como `inbound`.
- Lead ads criam mensagem inbound e card sem publicar `message.received` nem `deal.created`.
- `enqueueDelivery` (campanhas) publica o job de outbound DENTRO da transação: rollback deixa um job de mensagem que não existe.

## Escopo

### files_allowed

- `packages/shared/src/mq/domain-events.ts`
- `packages/shared/src/mq/*.test.ts`
- `apps/workers/src/leadgen/**`
- `apps/workers/src/campaigns/**`
- `apps/workers/src/coexistence/**`
- `docs/api-reference/guides/webhook-events.mdx`

## Escopo (faz)

- Ampliar o enum `trigger` (`inbound`, `reopened`, `lead_ad`, `app_echo`, `history`, `campaign`) mantendo o `eventId`; cada caminho manda o seu. Documentar no catálogo público.
- Lead ads: `message.received` e `deal.created` depois do commit, com os construtores do catálogo.
- Campanha: job de outbound publicado só depois do commit.

## Definition of Done

- [ ] teste de contrato do enum novo (e rejeição de valor fora dele)
- [ ] teste por caminho com o `trigger` certo
- [ ] teste: rollback em `enqueueDelivery` não publica job de outbound
