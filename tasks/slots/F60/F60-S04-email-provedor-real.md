---
id: F60-S04
title: E-mail de verdade — provedor Postmark, domínio autenticado, descadastro e rampa
phase: F60
status: available
priority: critical
estimated_size: L
depends_on: [F60-S03, F60-S08]
blocks: []
agent_id: backend-engineer

---
# F60-S04 — E-mail de verdade — provedor Postmark, domínio autenticado, descadastro e rampa

## Objetivo

Fazer o canal de e-mail enviar de verdade: provedor real atrás de `IEmailProvider`, domínio do cliente autenticado, descadastro de um clique e rampa de aquecimento.

## Contexto

auditoria de 2026-09-14: a F60-S03 e a F60-S08 construíram o canal inteiro — encadeamento, sanitização, bounce, supressão —, mas o único provedor que existe é o `FakeEmailProvider`. O adaptador do Postmark (escolhido no `ADR-001`) nunca foi escrito e não há credencial em produção. **Hoje o produto não envia e-mail.** Este ID estava reservado nos slots S03 e S07 como "F60-S04" e nunca tinha sido criado.

## Escopo

### files_allowed

- `packages/channels/src/email/**`
- `apps/workers/src/bootstrap/adapter-factory.ts`
- `apps/api/src/routes/webhooks/email.ts`
- `apps/api/src/routes/webhooks/*.test.ts`
- `apps/api/src/routes/channels/**`
- `packages/db/src/schema/channels.ts`
- `packages/db/drizzle/**`
- `apps/web/features/channels/**`
- `infra/docker/docker-compose.prod.yml`
- `.env.example`
- `docs/decisions/ADR-001-provedor-de-email.md`
- `apps/workers/src/inbound/worker.ts`, `apps/workers/src/inbound/index.ts`, `apps/api/src/routes/webhooks/index.ts` *(adicionados em 2026-10-07: ligar o inbound da F60-S10, ver Notas)*

### files_forbidden

- `packages/shared/src/consent.ts`
- `apps/workers/src/outbound/consent-gate.ts`

## Escopo (faz)

- `PostmarkEmailProvider` implementando `IEmailProvider`, com erros tipados permanente/transitório.
- Autenticação de domínio por cliente (SPF, DKIM, retorno), com o estado de cada registro DNS na tela.
- `List-Unsubscribe` e `List-Unsubscribe-Post` de um clique em todo envio de marketing, ligado à supressão da F59.
- Rampa de aquecimento por domínio novo.
- Assinatura do webhook do Postmark no verificador da F60-S08.

## Fora de escopo

- Editor visual de HTML.

## Definition of Done

- [ ] Envio real em conta de teste do Postmark, com mensagem recebida e encadeada.
- [ ] Domínio sem DKIM válido não envia marketing; a tela diz o que falta no DNS.
- [ ] Descadastro de um clique suprime o contato no canal e-mail.
- [ ] Rampa limita volume de domínio novo.
- [ ] Credencial só em variável de ambiente ou cifrada; nunca em log.
- [ ] O `FakeEmailProvider` continua sendo o padrão de teste.

## Validação

```bash
pnpm --filter @hm/channels test
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- A régua: o cliente manda um e-mail pelo Leadium e ele chega na caixa de entrada, não no spam.

### Herdado da F60-S10 (2026-10-07) — sem isto o e-mail não funciona de ponta a ponta

1. **O banco recusa canal de e-mail.** A constraint `channels_provider_columns` (migration 0002) só
   aceita `meta_whatsapp`, `meta_instagram` e `waha`: nenhum canal `email` pode ser criado hoje — trava
   o envio (F60-S03) e o recebimento (F60-S10). Migration nova ampliando a constraint para o provider
   de e-mail e suas colunas. Ao corrigir, os 2 testes pulados do resolver de canal em
   `apps/workers/src/inbound/email-inbound.test.ts` passam a rodar sozinhos.
2. **Ninguém chama `handleEmailInbound`.** A rota `webhooks/email.ts` está montada inerte (recusa tudo).
   Ligar a rota ao consumidor da fila em `worker.ts`/`index.ts`/`webhooks/index.ts`, junto do provedor
   real. Contrato da fila: o Zod `emailInboundPayloadSchema`.
3. **Teto do corpo do webhook:** hoje 10 MB; o Postmark manda inbound de até 35 MB. Decidir o teto.
4. **`Message-ID`:** se o id devolvido pelo Postmark no envio diferir do cabeçalho SMTP `Message-ID`,
   respostas a mensagens nossas não casam com a conversa (o thread é por `In-Reply-To`/`References`).
   Gravar o cabeçalho real ou fixar o `Message-ID` no envio.
5. **Índice sugerido** em migration futura: `messages (workspace_id, external_id)` — a busca de thread
   filtra por `external_id`, hoje só indexado junto com `conversation_id`.
