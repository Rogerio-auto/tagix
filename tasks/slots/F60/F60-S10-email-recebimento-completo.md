---
id: F60-S10
title: E-mail recebido completo — anexo no R2, anti-SSRF e reuso de thread
phase: F60
status: available
priority: high
estimated_size: M
depends_on: [F60-S08]
blocks: []
agent_id: backend-engineer

---
# F60-S10 — E-mail recebido completo — anexo no R2, anti-SSRF e reuso de thread

## Objetivo

Fechar os três itens do recebimento de e-mail que ficaram de fora da F60-S08.

## Contexto

A F60-S08 foi marcada como concluída com três itens do DoD desmarcados, e nenhum deles tem implementação no código (auditoria de 2026-09-14).

## Escopo

### files_allowed

- `apps/workers/src/inbound/email-*.ts`
- `apps/workers/src/inbound/*.test.ts`
- `apps/api/src/routes/webhooks/email.ts`
- `apps/api/src/routes/webhooks/*.test.ts`
- `packages/channels/src/email/**`

### files_forbidden

- `packages/shared/src/consent.ts`

## Escopo (faz)

- Anexo inbound vai para o R2 e a mensagem referencia por `external_id`, como a mídia da Meta.
- Anti-SSRF em toda URL vinda do e-mail, com a política da F56-S07.
- `threadKeyFrom` reusa a conversa existente; assunto alterado não abre conversa nova.

## Fora de escopo

- Provedor real (F60-S04).

## Definition of Done

- [ ] Anexo recebido abre na conversa a partir do R2.
- [ ] URL interna, de loopback ou de metadados de nuvem é recusada; teste cobre.
- [ ] Resposta com assunto alterado cai na mesma conversa; teste cobre "Re:" e "Fwd:".

## Validação

```bash
pnpm --filter @hm/workers test
pnpm --filter @hm/api test
pnpm lint
```

## Notas

- A régua: o cliente responde um e-mail de três semanas atrás e a conversa continua de onde parou.
