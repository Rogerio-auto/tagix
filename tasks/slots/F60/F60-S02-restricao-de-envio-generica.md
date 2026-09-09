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

- `apps/web/features/inbox/composer/**`
- `apps/api/src/routes/conversations/composer-state.ts`
- `apps/api/src/routes/conversations/*.test.ts`

### files_forbidden

- `packages/shared/src/consent.ts`
- `apps/workers/**`

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
