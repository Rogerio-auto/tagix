---
id: F60-S02
title: Restrição de envio genérica no composer
phase: F60
status: in-progress
priority: high
estimated_size: S
depends_on: [F60-S01]
blocks: [F60-S03]
source_docs:
  - docs/features/CANAIS_PLAN.md
  - docs/features/LIVECHAT.md
agent_id: backend-engineer
claimed_at: 2026-09-09T14:22:32Z

---
# F60-S02 — Restrição de envio genérica no composer

## Objetivo

Generalizar a trava do composer de "janela 24h da Meta" para **restrição de envio do canal**, com o
motivo exibido ao atendente — porque SMS tem janela horária legal, e-mail não tem janela nenhuma, e
Instagram tem regra própria.

## Contexto

`CANAIS_PLAN` §3.3. Hoje a trava é específica de Meta; o portão da F59-S04 já produz o motivo certo
por canal e mercado, e o composer precisa consumir isso em vez de reimplementar.

## Escopo

### files_allowed

- `packages/shared/src/consent.ts`
- `packages/shared/src/consent.test.ts`
- `apps/api/src/routes/conversations/window.ts`
- `apps/api/src/routes/conversations/restriction.test.ts`
- `apps/web/features/inbox/composer/**`
- `apps/api/src/routes/conversations/composer-state.ts`
- `apps/api/src/routes/conversations/*.test.ts`

### files_forbidden

- `apps/workers/**`

> `packages/shared/src/consent.ts` saiu de `files_forbidden`: ao ligar o segundo consumidor
> descobri um **defeito** naquele arquivo (janela horaria aplicada a mensagem transacional) que
> so aparece deste lado. Detalhe abaixo.

## Definition of Done

- [ ] O estado do composer vem do portão (`decideOutbound`), não de regra duplicada na UI.
- [ ] Cada bloqueio exibe **por quê** e, quando aplicável, **quando volta a poder** (`retryAt`).
- [ ] A trava de 24h do WhatsApp continua funcionando exatamente como hoje — teste de regressão.
- [ ] Contato suprimido bloqueia o composer com mensagem clara, e o atendente entende que não é bug.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/web typecheck
pnpm lint
```

## Notas

- O atendente precisa distinguir "não pode agora" de "não pode nunca". São ações diferentes.

## Defeito encontrado e corrigido na F59-S04 (2026-09-09)

**A janela horaria estava sendo aplicada a mensagem transacional.** Na pratica: um atendente ficaria
impedido de responder as 21h05 a quem escreveu as 21h04.

Isso nao aparecia antes porque o **primeiro** consumidor do portao foi a campanha, que e sempre
`marketing`. So ao ligar o composer — que e sempre `transactional` — o erro ficou visivel.

A restricao do TCPA e sobre **solicitacao comercial**. Resposta a quem acabou de escrever,
confirmacao de agendamento e lembrete nao sao solicitacao, e bloquea-los quebraria o uso central do
produto sem nenhum ganho de conformidade. `decideOutbound` agora aplica a janela apenas quando
`purpose === 'marketing'`; supressao continua vencendo **tudo**, inclusive transacional, e ha teste
para os tres casos.

## Decisoes tomadas na execucao

1. **`restriction` e ADITIVO; `window` fica intacto.** A UI atual consome `window` e continua
   funcionando sem mudanca. O contrato novo responde "posso enviar agora?", "por que nao" e "quando
   volta a poder", que e o que o atendente precisa.
2. **Fora da janela do provider NAO e bloqueio** — e mudanca de modo. WhatsApp fora das 24h devolve
   `canSend: true` com `reason: 'provider_window'`, para a UI oferecer o modelo aprovado em vez de
   exibir campo morto. Instagram idem, com a tag de atendimento humano.
3. **O portao vence a janela.** Contato suprimido nao recebe nem dentro das 24h: a janela diz o que a
   Meta permite, o portao diz o que a pessoa consentiu.
4. **Conversa sem contato** (grupo, thread de comentario orfa) nao consulta consentimento — nao ha a
   quem consultar. A janela do provider decide sozinha.
5. **A composicao e pura** (`toRestriction`) e testada sem banco, como o resto do portao.

## Resultado

`@hm/shared` 126 verdes (3 novos da correcao) · `@hm/api` 1030 verdes (9 novos) · `@hm/workers` 493
verdes, sem regressao.
