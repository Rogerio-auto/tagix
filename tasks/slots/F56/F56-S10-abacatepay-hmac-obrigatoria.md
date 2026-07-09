---
id: F56-S10
title: AbacatePay — HMAC obrigatória em produção (secret fora da query)
phase: F56
status: available
priority: medium
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S10 — AbacatePay: HMAC obrigatória (SEC-07)

> **Origem:** AUDITORIA_TECNICA.md §3.1. A auth do webhook de pagamento compara `?webhookSecret=` na query string (vaza em logs/Sentry/Traefik); a camada HMAC é opcional.

## Objetivo

Blindar a fonte da verdade de billing tornando a verificação HMAC obrigatória em produção e tirando o segredo da query string.

## Contexto / causa raiz (verificada)

`apps/api/src/routes/webhooks/abacatepay.ts:254-257` compara o secret da query (constant-time, mas na URL); `packages/payments/src/webhook.ts:42-48` — camada HMAC (`ABACATEPAY_PUBLIC_KEY`) opcional.

## Escopo (faz)

- Exigir HMAC (`ABACATEPAY_PUBLIC_KEY`) em produção: sem ela, recusar o webhook (fail-closed) em vez de cair só na query.
- Preferir header ao query param para o segredo; garantir redaction da query no logger.

## Escopo (não faz)

- Fluxo de billing/dunning (fora). Outros webhooks.

## Arquivos permitidos

- `apps/api/src/routes/webhooks/abacatepay.ts`
- `apps/api/src/routes/webhooks/abacatepay.test.ts`
- `packages/payments/src/webhook.ts`

## Arquivos proibidos

- `apps/api/src/routes/webhooks/meta.ts` · `waha.ts` · `apps/api/src/routes/webhooks/index.ts`

## Definition of Done

- [ ] Em produção sem HMAC válida, o webhook é recusado (teste).
- [ ] Segredo não trafega mais em posição logável, ou a query é redigida no logger.
- [ ] `pnpm typecheck` + `pnpm lint` + testes de payments/api verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Coordenar o header/rota do webhook com o painel AbacatePay (config externa) — documentar no PR.
