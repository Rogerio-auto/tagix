---
id: F60-S11
title: Composer mostra a restrição de envio — por quê e quando volta a poder
phase: F60
status: done
priority: medium
estimated_size: S
depends_on: [F60-S02]
blocks: []
agent_id: frontend-engineer
claimed_at: 2026-10-07T17:43:39Z
completed_at: 2026-10-07T17:53:37Z

---
# F60-S11 — Composer mostra a restrição de envio — por quê e quando volta a poder

## Objetivo

O atendente vê no campo de mensagem por que não pode enviar e quando volta a poder, a partir do portão de consentimento — não de regra duplicada na interface.

## Contexto

A F60-S02 entregou `SendRestriction` e `toRestriction` na API (`routes/conversations/window.ts`), mas a interface de conversas não consome esse estado (auditoria de 2026-09-14). Os quatro itens do DoD dependiam da interface.

## Escopo

### files_allowed

- `apps/web/features/conversations/**`
- `apps/api/src/routes/conversations/window.ts`
- `apps/api/src/routes/conversations/*.test.ts`

### files_forbidden

- `packages/shared/src/consent.ts`

## Escopo (faz)

- Composer lê a restrição da API e mostra motivo e `retryAt` em linguagem de atendente.
- Contato suprimido bloqueia com mensagem clara de que não é defeito.
- A trava de 24h do WhatsApp continua igual.

## Fora de escopo

- Mudança nas regras do portão.

## Definition of Done

- [x] Nenhuma regra de bloqueio duplicada na interface. — `composerGate` (`sendRestriction.ts`) só traduz `restriction.canSend`/`reason` e as flags da janela em modo de tela; teste "a tela não inventa bloqueio".
- [x] Motivo e horário de liberação exibidos. — `RestrictionNotice`: título + frase da API + linha "quando volta" (`retryAt` → "hoje/amanhã às HH:MM", senão a condição que libera); 5 testes de `formatRetryAt`/`untilLine`.
- [x] Regressão da janela de 24h do WhatsApp. — API: `computeWindow` (23h aberta, 24h exatas fechada, sem inbound, IG tag, WAHA/e-mail); web: modo `template`, aviso `role=alert` com o mesmo texto, fallback para API sem `restriction`.
- [x] Contato suprimido tem texto próprio. — "Envio travado a pedido do contato" + "Não é uma falha do sistema" + "Sem previsão de liberação", tom neutro (sem danger, sem alert); o portão vence a janela (suprimido fora das 24h não mostra CTA de modelo).

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
```

## Notas

- A régua: o atendente nunca abre chamado achando que o envio travou por defeito.

## Entrega (2026-10-07)

Commits de implementação: `3bf31fe9` (api) · `e42c0add` (web).

- `apps/api/src/routes/conversations/window.ts` — `toRestriction` troca o identificador técnico do
  canal na frase do portão (`por meta_whatsapp` → `por WhatsApp`, `email` → `e-mail`); provider
  `email` aceito pelo `/window` (sem janela; antes 422); `computeWindow` exportada.
- `apps/web/features/conversations/components/MessageComposer/sendRestriction.ts` — `composerGate`,
  texto por motivo, `formatRetryAt`, `untilLine` (puros).
- `.../RestrictionNotice.tsx` — aviso do portão + estado de erro da consulta.
- `.../MessageComposer.tsx`, `WindowNotice.tsx`, `useWindowState.ts`, `index.ts`.

## Decisões

1. **A tela não decide.** O modo do composer vem de `restriction` (API). O texto por motivo é
   apresentação do enum estável do portão, não regra.
2. **Suprimido em tom neutro**, não `danger`: é o sistema respeitando o pedido do contato.
   Vermelho faria o atendente abrir chamado — exatamente o que a régua do slot proíbe.
3. **Erro ≠ liberado.** Falha ao consultar mostra aviso com "Tentar de novo" e NÃO trava (a API
   confere no envio). Carregando também não trava (comportamento anterior preservado).
4. **CTA "Reabrir com template" só com handler.** Nenhum consumidor passava `onReopenWithTemplate`:
   o botão era morto. Agora some até existir o seletor de modelo na conversa (texto do aviso igual).
5. **E-mail entra no portão.** `/window` devolvia 422 para conversa de e-mail; o composer ficava sem
   a recusa de contato suprimido por e-mail.
6. **Descompasso de deploy tolerado:** web novo com API sem `restriction` cai na trava antiga.
7. Data do aviso em pt-BR fixo (`COPY_LOCALE`), acompanhando o idioma do texto; marcado com TODO de
   i18n para a limpeza que lerá o market pack.

## Validação

- `pnpm typecheck` — verde (todos os projetos).
- `eslint` nos arquivos tocados — 0 erros, 0 avisos.
- `pnpm --filter @hm/web test` — 48 arquivos, 556 testes verdes (20 novos em `sendRestriction.test.tsx`).
- `apps/api` `vitest run src/routes/conversations/` — 13 arquivos, 134 verdes (8 novos em `restriction.test.ts`).
- e2e Playwright não roda neste host Windows; validação visual pendente.
