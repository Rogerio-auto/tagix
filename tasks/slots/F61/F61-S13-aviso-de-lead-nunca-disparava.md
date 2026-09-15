---
id: F61-S13
title: Aviso de lead novo nunca disparava — contrato único do message:new
phase: F61
status: in-progress
priority: critical
estimated_size: S
depends_on: [F61-S04]
blocks: []
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-15T04:42:51Z

---
# F61-S13 — Aviso de lead novo nunca disparava

## Objetivo

Fazer o aviso de lead novo da F61-S04 disparar de verdade, e impedir por contrato de tipo que
um emissor de `message:new` volte a omitir quem mandou a mensagem.

## Contexto

Encontrado em 2026-09-15, ao desenhar a F69-S03. O gancho da F61-S04 no relay só notifica quando
`message.senderType === 'contact'`. **Nenhum dos quatro emissores de `message:new` envia
`senderType`** (inbound, coexistência, flows e outbound). Resultado: toda mensagem real é
descartada pelo gancho, e o aviso nunca dispara.

O teste da F61-S04 passou porque montava o payload à mão, com o campo que o worker não envia.
É o tipo de teste que prova a regra e não prova a integração.

Alcance em produção: 1 aparelho assinado; nenhuma mensagem de contato desde o deploy da F61-S04.
Nenhum lead perdido ainda — o primeiro seria.

`MessageNewPayload.message` é `unknown` em `@hm/shared`, então o compilador não tinha como pegar.

## Escopo

### files_allowed

- `packages/shared/src/socket-events.ts`
- `packages/shared/src/socket-events.test.ts`
- `packages/shared/src/index.ts`
- `apps/workers/src/inbound/db-ports.ts`
- `apps/workers/src/coexistence/db-ports.ts`
- `apps/workers/src/flows/outbound-publisher.ts`
- `apps/workers/src/outbound/mq-ports.ts`
- `apps/workers/src/**/*.test.ts`
- `apps/api/src/socket/relay.ts`
- `apps/api/src/socket/relay.test.ts`

### files_forbidden

- `apps/api/src/services/notifications/**`

## Escopo (faz)

- `buildMessageNewPayload` em `@hm/shared`, com `senderType` e `direction` obrigatórios no tipo.
- Os quatro emissores passam a usá-lo.
- O gancho do relay e o teste passam a usar o mesmo tipo, e o teste parte da saída do construtor.
- Mensagem sincronizada da coexistência (histórico) **não** dispara aviso — é passado, não lead.

## Definition of Done

- [ ] Nenhum emissor monta o `message` à mão; o compilador recusa payload sem `senderType`.
- [ ] Teste do relay usa a saída de `buildMessageNewPayload`, não objeto literal.
- [ ] Mensagem ao vivo de contato dispara o aviso; resposta do atendente, mensagem de flow e histórico de coexistência não.
- [ ] Suítes de `@hm/shared`, `@hm/workers` e `@hm/api` verdes.

## Validação

```bash
pnpm --filter @hm/shared test
pnpm --filter @hm/workers test
pnpm --filter @hm/api test
pnpm typecheck
pnpm lint
```
