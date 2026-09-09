---
id: F60-S03
title: E-mail como canal — fundação, envio e encadeamento
phase: F60
status: done
priority: critical
estimated_size: L
depends_on: [F60-S01, F60-S02]
blocks: [F60-S04, F60-S07, F60-S08]
source_docs:
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T14:41:22Z
completed_at: 2026-09-09T15:06:07Z

---
# F60-S03 — E-mail como canal: fundação, envio e encadeamento

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
- `packages/shared/src/index.ts`
- `packages/channels/src/capabilities.ts`
- `apps/workers/src/bootstrap/adapter-factory.ts`
- `apps/web/features/channels/constants.tsx`
- `packages/db/drizzle/0073_f60_email_channel.sql`
- `packages/db/drizzle/meta/**`
- `packages/channels/src/email/*.test.ts`
- `apps/api/src/routes/webhooks/*.test.ts`

### files_forbidden

- `apps/workers/src/outbound/consent-gate.ts`

> `packages/shared/src/index.ts` entrou em `files_allowed`: `email` precisa existir em
> `CHANNEL_PROVIDERS` para o adapter tipar. `markets.ts` continua fora — `ChannelKind` ja
> inclui `email` desde a F59-S01, entao nao ha o que mudar la.

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

- [x] Thread encadeia por cabeçalho, e o teste cobre "Re:" e "Fwd:" com assunto alterado.
- [x] `email` existe em `CHANNEL_PROVIDERS`, no CHECK do banco e em todo `switch` exaustivo do repo.
- [x] `EmailChannelAdapter` implementa `IChannelAdapter`; recusa explicitamente o que e-mail não faz.
- [x] Capacidades declaradas no vocabulário da F60-S01, sem o que é da Meta.
- [x] `IEmailProvider` + `FakeEmailProvider`: canal testável sem credencial e sem rede.
- [x] O portão da F59 é consultado no envio — o adapter entra pelo worker outbound comum, sem caminho paralelo.
- [x] Coerência no banco: canal de e-mail sem remetente é recusado por CHECK; remetente único por workspace.

**Movido para F60-S08** (recebimento — ver "Escopo revisado" no fim):

- [ ] Anexo inbound vai para R2 e a mensagem referencia por `external_id`.
- [ ] Webhook valida assinatura do provider e recusa payload não assinado.
- [ ] Bounce duro suprime o endereço via `contact_suppressions`.
- [ ] Anti-SSRF em URL vinda do e-mail; HTML inbound sanitizado.

## Escopo revisado durante a execução (2026-09-09)

**Este slot estava grande demais — erro meu de planejamento.** Marquei como `L`, e a própria skill
`/hm-tasks` diz que `L` deve virar `M`s. Ao executar ficou claro que há duas metades com naturezas
diferentes:

- **Fundação + envio** (entregue aqui): contrato do provedor, encadeamento, provider fake, adapter,
  ampliação da união de providers, migration, cobertura de todos os `switch` exaustivos do repo.
  É uma unidade coerente e testada — 50 testes novos.
- **Recebimento** (movido para **F60-S08**): rota de webhook com verificação de assinatura, anexo
  para o R2, bounce duro suprimindo o endereço, sanitização de HTML e anti-SSRF. Cada um desses tem
  risco de segurança próprio e merece atenção dedicada, não o fim de um slot já longo.

Fechar S03 dizendo "e-mail pronto" seria falso — o canal envia e não recebe. Fechar dizendo o que
foi feito, e abrir o resto, é honesto e mantém o board útil.

## Decisões tomadas na execução

1. **`EmailSendOptions` como campo tipado e opcional (`input.email`), não `metadata: Record<string, unknown>`.**
   E-mail precisa de assunto e cadeia de referências; nenhum outro canal precisa. Espalhar `subject?`
   no contrato comum faria todo adapter carregar campo que não usa — o vício que `CANAIS_PLAN` §3.1
   descreve. Um objeto nomeado por canal mantém o contrato limpo **e** o tipo honesto.
2. **Encadeamento por cabeçalho, nunca por assunto.** Há teste explícito de que assunto alterado não
   parte a thread. Encadear por assunto funciona até o primeiro cliente que responde mudando o texto,
   e a partir daí o atendente perde o contexto sem ninguém entender por quê.
3. **`FakeEmailProvider` mora no código de produção, não em `__mocks__`.** É implementação de verdade
   do contrato, com as mesmas validações, e serve de referência executável para quem escrever o
   adapter real.
4. **`verifyWebhook` recusa tudo sem segredo configurado.** Aceitar payload não assinado deixaria
   alguém forjar um `hard_bounce` e suprimir o contato de um cliente.
5. **Broadcast sem `List-Unsubscribe` é recusado no envio.** Provedores grandes exigem na prática, e
   é a forma mais barata de honrar revogação. Falhar aqui é melhor que entregar no spam e descobrir
   quando o cliente reclamar que ninguém recebe.
6. **Conversa é sempre `transactional`.** Campanha usa `broadcast` e outro caminho: misturar os dois
   derruba a reputação do domínio do cliente, e a confirmação de agendamento é a última coisa que
   pode parar de chegar.
7. **A fábrica de adapters lança `AdapterUnavailableError` para `email`** até a F60-S04 injetar um
   provedor real. Explícito é melhor que devolver um adapter que falha no envio.
8. **Provedor real ainda não foi escolhido** — é decisão da F60-S04, junto com autenticação de
   domínio por cliente. O contrato foi desenhado a partir do que o plano exige (fluxos separados,
   parse de inbound, webhook de retorno, domínio por cliente), não a partir da API de um fornecedor.

## Resultado

`@hm/channels` 169 verdes (50 novos) · typecheck limpo nos 14 projetos · lint 0 erros ·
`@hm/db` 135, `@hm/api` 1030, `@hm/workers` 493 — sem regressão.

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
