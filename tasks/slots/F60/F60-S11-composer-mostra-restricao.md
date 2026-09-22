---
id: F60-S11
title: Composer mostra a restrição de envio — por quê e quando volta a poder
phase: F60
status: available
priority: medium
estimated_size: S
depends_on: [F60-S02]
blocks: []
agent_id: frontend-engineer

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

- [ ] Nenhuma regra de bloqueio duplicada na interface.
- [ ] Motivo e horário de liberação exibidos.
- [ ] Regressão da janela de 24h do WhatsApp.
- [ ] Contato suprimido tem texto próprio.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
```

## Notas

- A régua: o atendente nunca abre chamado achando que o envio travou por defeito.
