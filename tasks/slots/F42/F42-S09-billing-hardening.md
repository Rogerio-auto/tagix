---
id: F42-S09
title: Hardening de billing — auditoria de segurança + integração + validação sandbox
phase: F42
status: blocked
priority: high
estimated_size: M
depends_on: [F42-S03, F42-S04, F42-S05, F42-S07]
blocks: []
agent_id: security-auditor
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
---

# F42-S09 — Hardening de billing (capstone)

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §9/§10
> **blocks:** (nenhum — capstone da F42)

## Objetivo

Fechar a F42 com qualidade de caminho de dinheiro: auditoria de segurança (HMAC/replay/authz),
testes de integração ponta-a-ponta com o `MockPaymentProvider`, e um runbook de validação contra a
sandbox/key de produção da AbacatePay.

## Contexto

Caminho de dinheiro = barra máxima. Roda após o núcleo (S03/S04/S05/S07) estar implementado.

## Escopo (faz)

- Testes de integração `apps/api/src/routes/billing/billing.integration.test.ts`: fluxo
  checkout → webhook `completed` → status `active` → `renewed` → `cancelled` (via mock + assinatura HMAC).
- Auditoria de segurança: HMAC obrigatório, anti-replay, authz (self-serve por workspace; assistido
  platform-only), ausência de segredo em logs, validação de input. Achados corrigidos dentro do escopo
  dos arquivos abaixo (ou registrados como follow-up se cruzarem fronteira de outro slot).
- `docs/runbooks/payments-abacatepay.md`: como trocar para a key de produção, registrar o webhook
  HTTPS (`webhooks/create`), e o checklist de validação na sandbox.

## Fora de escopo

- Reimplementar lógica dos slots S01–S08 (apenas testar/auditar/documentar; correções pontuais ok).

## Arquivos permitidos

- `apps/api/src/routes/billing/billing.integration.test.ts`
- `docs/runbooks/payments-abacatepay.md`

## Arquivos proibidos

- (correções que exijam tocar arquivos de outros slots → abrir follow-up, não editar aqui)

## Definition of Done

- [ ] Teste de integração do ciclo de vida (checkout→webhook→renew→cancel) passa.
- [ ] Auditoria executada; achados altos/críticos corrigidos ou registrados; sem segredo em logs.
- [ ] Runbook de produção/sandbox escrito.
- [ ] `pnpm --filter @hm/api test` + typecheck + lint verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **security-auditor** / **qa-engineer**. Validação real E2E (key de produção + webhook
  HTTPS público) é seam de infra (§10) — depende do fundador subir na VPS.
