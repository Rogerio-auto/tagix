---
id: F58-S07
title: Tornar o início da campanha fácil de entender
phase: F58
status: in-progress
priority: high
estimated_size: S
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-09-10T02:57:15Z

---
# F58-S07 — Tornar o início da campanha fácil de entender

## Objetivo

Criar a primeira etapa do novo fluxo com escolhas reconhecíveis pelo usuário:
objetivo/nome, WhatsApp conectado e envio único ou sequência de mensagens.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/basics/**`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/api/**`

## Definition of Done

- [x] Opções usam **Envio único** e **Sequência de mensagens**, com exemplo curto de cada uma.
- [x] `Broadcast`, `Drip` e `Triggered` não aparecem na interface.
- [x] Somente canais elegíveis podem ser selecionados; canal desconectado oferece caminho para configuração.
- [x] Seleção informa que modelos aprovados são necessários antes de avançar.
- [x] Validação é inline, preserva dados ao voltar e possui testes de teclado/mobile.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
```

## Notas

- A integração com o orquestrador do wizard pertence ao F58-S12.

## Decisões tomadas na execução (2026-09-09)

1. **A regra é pura, o componente é só apresentação.** "Posso avançar?" é a pergunta mais cara de
   errar num wizard — liberar cedo leva o usuário a um passo que vai falhar depois; travar sem
   motivo faz ele desistir no primeiro campo, e quem desiste no primeiro campo não volta. Sendo
   pura, a regra inteira tem teste sem React.

2. **Cada modo traz um exemplo concreto.** "Sequência de mensagens" não significa nada sozinho;
   "uma agora e outra depois de alguns dias, para quem não respondeu" significa.

3. **Canal inelegível aparece DESABILITADO, com o motivo e um caminho.** Escondê-lo produziria a
   pior pergunta de suporte que existe: "cadê meu número?".

4. **A mensagem de inelegibilidade vem da API, não da UI.** A API sabe o provider; dizer
   "reconecte o número do WhatsApp" quando o problema é o remetente de e-mail seria pior que não
   dizer nada. (Reusa `ineligibleMessageFor`, do F60-S07.)

5. **Canal sem modelo aprovado AVISA, não trava.** O problema se resolve no passo da mensagem ou
   em outra aba; travar aqui obrigaria a abandonar o rascunho — e rascunho abandonado não vira
   campanha.

6. **Canal que sumiu da lista vira erro explícito.** Desconectado noutra aba ou removido por outro
   membro: silenciar deixaria o usuário travado num erro que só apareceria no fim do wizard.

7. **Erro só depois do primeiro toque no campo.** Formulário que já abre vermelho ensina o
   usuário a ignorar vermelho.

8. **Ordem dos canais é a ordem que ajuda a decidir:** elegíveis primeiro, e entre eles os que já
   têm modelo aprovado — os que realmente conseguem enviar hoje.

9. **Nenhuma mensagem de erro cita termo interno.** Há teste que falha se `broadcast`, `drip`,
   `triggered`, `channelId` ou `null` vazarem para o texto.

## Resultado

- 13 testes em `basics/model.test.ts`. Typecheck limpo. Lint: 0 erros.
- A integração com o orquestrador do wizard continua sendo do F58-S12, como previsto: o passo
  publica `onValidityChange` e não sabe navegar.
