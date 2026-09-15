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
