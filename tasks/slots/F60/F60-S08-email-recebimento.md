---
id: F60-S08
title: E-mail — recebimento, retorno e supressão por bounce
phase: F60
status: blocked
priority: critical
estimated_size: M
depends_on: [F60-S03]
blocks: [F60-S07]
source_docs:
  - docs/features/CANAIS_PLAN.md
---

# F60-S08 — E-mail: recebimento, retorno e supressão por bounce

## Objetivo

Fechar o canal de e-mail: receber na inbox, processar o retorno assíncrono do provedor e suprimir
automaticamente quem deu bounce duro ou reclamou de spam.

## Contexto

A F60-S03 entregou a fundação e o envio; hoje o canal envia e não recebe. Cada peça deste slot tem
risco de segurança próprio — assinatura de webhook, HTML de terceiro, URL de terceiro — e por isso
saiu de um slot que já estava longo demais.

## Escopo

### files_allowed

- `apps/api/src/routes/webhooks/email.ts`
- `apps/api/src/routes/webhooks/*.test.ts`
- `apps/api/src/routes/webhooks/index.ts`
- `packages/channels/src/email/sanitize.ts`
- `packages/channels/src/email/*.test.ts`
- `apps/workers/src/inbound/email-*.ts`
- `apps/workers/src/inbound/*.test.ts`

### files_forbidden

- `packages/channels/src/email/adapter.ts`
- `packages/shared/src/consent.ts`

## Definition of Done

- [ ] Webhook **recusa payload não assinado** — sem isso, alguém forja um `hard_bounce` e suprime o contato de um cliente.
- [ ] Anexo inbound vai para R2 e a mensagem referencia por `external_id`, como a mídia da Meta.
- [ ] **Bounce duro e reclamação de spam suprimem o endereço** em `contact_suppressions` (canal `email`), reusando `consentRepo.revoke`.
- [ ] Bounce leve **não** suprime: é transitório, e suprimir por caixa cheia perde o cliente para sempre.
- [ ] HTML inbound é sanitizado antes de chegar à UI. E-mail é vetor clássico de XSS armazenado, e a política de SVG do `uploads.ts` mostra que o repo já leva isso a sério.
- [ ] Anti-SSRF em qualquer URL vinda do e-mail (política de F56-S07).
- [ ] A thread encontrada por `threadKeyFrom` reusa a conversa existente; assunto alterado não cria conversa nova.
- [ ] Rate limit no webhook público, como nos demais.

## Validação

```bash
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/channels test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- Bounce duro que não suprime é o caminho mais rápido para queimar o domínio do cliente.
- Suprimir por bounce leve é o caminho mais rápido para perder um cliente que só estava de férias
  com a caixa cheia. A distinção importa e precisa estar testada.
