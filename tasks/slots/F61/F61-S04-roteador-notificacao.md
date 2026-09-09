---
id: F61-S04
title: Roteador de notificação — dedupe, preferência por evento e fuso do membro
phase: F61
status: in-progress
priority: high
estimated_size: L
depends_on: [F61-S03]
blocks: []
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T23:11:33Z

---
# F61-S04 — Roteador de notificação

## Objetivo

Um evento decide **por onde avisa**, uma vez só — para o dono não receber a mesma coisa
três vezes e desligar tudo.

## Contexto

`APP_MOBILE_PLAN` §4.2. A F61-S03 entregou o canal (push por dispositivo). Falta a decisão:
o mesmo "lead novo" pode virar push, WhatsApp e e-mail simultâneos.

> Sem esse roteador, o dono recebe a mesma coisa três vezes e desliga tudo — e aí você perdeu
> o canal que sustentava o speed-to-lead.

Notificação demais não é um incômodo: é a destruição do canal. Uma vez que o dono desliga, ele
não religa, e o tempo de resposta — o número que fecha venda — volta ao que era antes do produto.

## Escopo (faz)

1. **Preferência por TIPO de evento**, não um interruptor geral. "Me avise de lead novo, não de
   mensagem em conversa que já estou acompanhando."
2. **Dedupe por janela**: se a pessoa abriu o app nos últimos N minutos, não mandar WhatsApp —
   ela já viu.
3. **Silêncio por horário, no fuso do MEMBRO** (não no do servidor nem no do workspace).
4. **Fallback em cascata**, não em paralelo: push falhou ou não existe → WhatsApp → e-mail.
5. **Registro do que foi enviado**, para o dedupe ter memória e para responder "por que não fui
   avisado?".

## Fora de escopo

- Badge de não-lidos e link profundo (F61-S08).
- Preferências de notificação de CONTATO (é outro domínio: consentimento, F59).

## Definition of Done

- [ ] Um evento nunca gera dois avisos do mesmo tipo no mesmo canal.
- [ ] Preferência é por tipo de evento e tem default seguro.
- [ ] Janela de silêncio usa o fuso do membro.
- [ ] Cascata: e-mail só sai se push e WhatsApp não resolveram.
- [ ] Push desligado (sem VAPID) degrada para o próximo canal sem erro.
- [ ] RLS em tudo que for tabela nova.

## Validação

```bash
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- A régua: o dono confia no aviso o suficiente para não conferir o app "por garantia".
