---
id: F70-S14
title: Origem real no conversation.opened, eventos de lead ads e outbound da campanha depois do commit
phase: F70
status: done
priority: medium
estimated_size: S
depends_on: [F70-S13]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S13-conversation-opened-em-todos-os-caminhos.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:44:19Z
completed_at: 2026-09-25T05:17:01Z

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

- [x] teste de contrato do enum novo (e rejeição de valor fora dele)
- [x] teste por caminho com o `trigger` certo
- [x] teste: rollback em `enqueueDelivery` não publica job de outbound

## Validação

```bash
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/leadgen/db-store.test.ts src/coexistence/conversation-opened.test.ts src/campaigns/conversation-opened.test.ts --maxWorkers=2
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq/domain-events.test.ts --maxWorkers=2
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
```

## Resumo

- **Contrato:** `CONVERSATION_OPENED_TRIGGERS` = `inbound | lead_ad | app_echo | history |
  campaign | reopened` (exportado de `@hm/shared/mq`). Toda criação mantém o eventId
  `<conversa>:opened` (a origem não muda a identidade); `reopened` segue por ocorrência. Valor
  fora do enum é rejeitado na publicação (`emitDomainEvent` → `false`). Guia público com a
  tabela de origens e a sequência de eventos do lead ads.
- **Por caminho:** lead ads `lead_ad`; eco do app WhatsApp e Instagram `app_echo`; importação de
  histórico `history`; disparo de campanha `campaign`. Inbound e reabertura (API) inalterados.
- **Lead ads:** depois do commit, na ordem `conversation.opened` → `message.received` (resumo do
  formulário) → `deal.created` (via `dealCreatedFromRow`, a partir do RETURNING). Card existente
  vira nota e não anuncia; perdedor da corrida e reprocesso não publicam nada.
- **Campanha:** o envelope do job é montado na transação e publicado só depois do commit, após o
  `conversation.opened`. Falha ao publicar depois do commit roda uma transação de compensação
  (apaga a delivery, liberando a idempotencyKey; apaga a mensagem `pending`; recipient volta ao
  passo anterior com o backoff de falha, guardado pelo estado que o disparo gravou) e relança.
- **Testes:** contrato (19 no arquivo, 9 novos), leadgen 8, coexistência 5 (novo: eco do
  Instagram), campanha 4 (sonda prova a mensagem do job já commitada no instante da publicação;
  rollback forçado no drip não publica job; compensação + retentativa enfileira de novo).
- **Pendências:** a publicação do job continua sem publisher confirms (`sendToQueue` só falha
  com o canal fechado; queda do processo entre commit e publicação deixa a delivery `queued` sem
  job, sem reconciliador). O caminho certo é um outbox transacional, o mesmo que falta aos
  eventos de domínio.
