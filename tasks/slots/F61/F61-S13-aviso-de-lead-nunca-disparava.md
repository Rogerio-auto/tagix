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

- [x] Nenhum emissor monta o `message` à mão; o compilador recusa payload sem `senderType`.
- [x] Teste do relay usa a saída de `buildMessageNewPayload`, não objeto literal.
- [x] Mensagem ao vivo de contato dispara o aviso; resposta do atendente, mensagem de flow e histórico de coexistência não.
- [x] Suítes de `@hm/shared`, `@hm/workers` e `@hm/api` verdes.

## Validação

```bash
pnpm --filter @hm/shared test
pnpm --filter @hm/workers test
pnpm --filter @hm/api test
pnpm typecheck
pnpm lint
```

## Decisões tomadas na execução (2026-09-15)

1. **Contrato no tipo, não na disciplina.** `MessageNewPayload.message` deixou de ser `unknown`:
   `senderType` e `origin` são obrigatórios em `MessageNewMessage`, e todo emissor passa por
   `buildMessageNewPayload`. Um emissor novo que esqueça qualquer um dos dois não compila.
2. **A regra do aviso mora ao lado do contrato** (`newMessageNotificationTarget`, em `@hm/shared`),
   e o teste dela parte da saída do construtor. O teste da F61-S04 montava o payload à mão, com o
   campo que nenhum emissor mandava — provava a regra e não provava a integração.
3. **`origin` separa o que acabou de acontecer do que foi sincronizado.** Mensagem que a coexistência
   traz do WhatsApp Business do cliente nunca avisa: sincronizar histórico não pode tocar o celular
   uma vez por mensagem antiga.
4. **Remetente desconhecido é declarado, não chutado.** O job de outbound não carrega quem enviou
   (são oito produtores: atendente, API pública, campanha, comentário, agente, lembrete…), e a
   persistência real publica numa fila, então não tem como devolver o valor. O outbound declara
   `senderType: null`. Como o aviso só dispara para `'contact'`, `null` nunca avisa. Levar a origem
   para o job é mudança nos oito produtores e fica fora deste slot.
5. **O relay perdeu a cópia local da regra** e passou a usar a de `@hm/shared`.

## Resultado

- `@hm/shared` 173 testes (7 novos do contrato), `@hm/workers` 492 (1 estouro de tempo em
  `evaluation.test`, que passa isolado e não importa nada alterado), relay e notificações 23.
- Typecheck limpo em `@hm/shared`, `@hm/api`, `@hm/workers` e `@hm/web`. Lint: 0 erros.

## Validação que só o Rogério consegue fazer

Com o app instalado no iPhone e os avisos ligados, mandar uma mensagem de WhatsApp de outro número
para o número da empresa. Deve chegar "Nova mensagem · WhatsApp" (ou "Lead novo", se for o primeiro
contato daquele número), sem o conteúdo da mensagem na tela bloqueada.
