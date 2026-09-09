---
id: F60-S03
title: E-mail como canal — envio, recebimento e encadeamento
phase: F60
status: in-progress
priority: critical
estimated_size: L
depends_on: [F60-S01, F60-S02]
blocks: [F60-S04, F60-S07]
source_docs:
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T14:41:22Z

---
# F60-S03 — E-mail como canal: envio, recebimento e encadeamento

## Objetivo

E-mail entra na inbox como qualquer conversa: o cliente escreve, o atendente responde, o agente pode
responder, e a thread se mantém encadeada.

## Contexto

`CANAIS_PLAN` §4 — e-mail é **P0**: serve os dois mercados, não tem registro prévio nem prazo
externo, e é o canal de nutrição que hoje não existe.

## Escopo

### files_allowed

- `packages/channels/src/email/**`
- `packages/channels/src/index.ts`
- `packages/channels/src/types.ts`
- `apps/workers/src/inbound/parse.ts`
- `apps/workers/src/inbound/email-*.ts`
- `apps/api/src/routes/webhooks/email.ts`
- `packages/db/src/schema/channels.ts`
- `packages/db/drizzle/0073_f60_email_channel.sql`
- `packages/db/drizzle/meta/**`
- `packages/channels/src/email/*.test.ts`
- `apps/api/src/routes/webhooks/*.test.ts`

### files_forbidden

- `apps/workers/src/outbound/consent-gate.ts`
- `packages/shared/src/markets.ts`

## Escopo (faz)

- `IEmailProvider` atrás de interface, com adapter concreto e um fake para teste.
- `EmailChannelAdapter` implementando `IChannelAdapter`: `sendText` (corpo + assunto), `sendMedia`
  (anexo), `parseInbound`.
- **Encadeamento por `Message-ID` / `In-Reply-To` / `References`** — nunca por assunto, que é
  heurística e falha em "Re: Re: Fwd:".
- Webhook de inbound: parse MIME, anexos para R2, verificação de assinatura do provider.
- `conversations.kind` ganha `email_thread`; uma pessoa pode ter N threads abertas.
- Estados de retorno: entregue, bounce duro, bounce leve, reclamação.

## Fora de escopo

- Sequências e campanhas de e-mail (F60-S04).
- Autenticação de domínio por cliente (F60-S04, junto com a rampa).
- Editor de HTML (F60-S04).

## Definition of Done

- [ ] Thread encadeia por cabeçalho, e o teste cobre "Re:" e "Fwd:" com assunto alterado.
- [ ] Anexo inbound vai para R2 e a mensagem referencia por `external_id`, como a mídia da Meta.
- [ ] Webhook valida assinatura do provider e recusa payload não assinado.
- [ ] **Bounce duro suprime o endereço automaticamente** via `contact_suppressions` (canal `email`).
- [ ] O portão da F59 é consultado no envio, como qualquer canal — sem caminho paralelo.
- [ ] Anti-SSRF aplicado a qualquer URL vinda do e-mail (a política de F56-S07 vale aqui).
- [ ] E-mail HTML inbound é sanitizado antes de chegar à UI: e-mail é vetor clássico de XSS armazenado.

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

- Encadear por assunto parece funcionar até o primeiro cliente que responde mudando o assunto.
- Bounce duro que não suprime é o caminho mais rápido para queimar o domínio do cliente.
