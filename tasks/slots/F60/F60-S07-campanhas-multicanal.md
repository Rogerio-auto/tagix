---
id: F60-S07
title: Campanhas para os outros canais
phase: F60
status: review
priority: critical
estimated_size: L
depends_on: [F60-S03]
blocks: []
source_docs:
  - docs/features/CANAIS_PLAN.md
  - docs/features/CAMPAIGNS.md
agent_id: backend-engineer
claimed_at: 2026-09-09T16:31:19Z
completed_at: 2026-09-09T17:22:07Z

---
# F60-S07 — Campanhas para os outros canais

## Objetivo

Permitir criar campanha em qualquer canal disponível — e-mail, Instagram, SMS quando existir — e não
só WhatsApp, com conteúdo, público e métrica declarados **por canal**.

## Contexto

Pedido direto do Rogério (2026-09-09): "nas tarefas de campanhas tem que ser possível criar campanhas
para os outros canais". O criador nasceu WhatsApp-cêntrico e a F58 reforçou isso — o fluxo guiado
gira em torno de modelo HSM aprovado pela Meta, conceito que só existe no WhatsApp oficial.
Desenho em `CANAIS_PLAN` §12.

## Escopo

### files_allowed

- `apps/api/src/routes/campaigns/builder/**`
- `apps/api/src/routes/campaigns/validate.ts`
- `apps/api/src/routes/campaigns/service.ts`
- `apps/api/src/routes/campaigns/*.test.ts`
- `packages/db/src/schema/campaigns.ts`
- `packages/db/drizzle/0075_f60_campaign_channel_content.sql`
- `packages/db/drizzle/meta/**`
- `apps/workers/src/campaigns/steps/**`
- `apps/workers/src/campaigns/*.test.ts`
- `apps/web/features/campaigns/**`
- `apps/api/src/routes/campaigns/validate.ts`
- `apps/api/vitest.config.ts`
- `apps/workers/vitest.config.ts`

### files_forbidden

- `apps/workers/src/outbound/**`
- `packages/shared/src/consent.ts`

## Escopo (faz)

- **Conteúdo por canal**, não conteúdo único traduzido: e-mail tem assunto e corpo HTML; SMS tem
  texto com segmentação; WhatsApp tem modelo aprovado; Instagram não tem modelo nenhum.
- **Elegibilidade vem da capacidade do adapter** (F60-S01), não de `if` por canal. O wizard monta os
  passos perguntando ao adapter: exige modelo aprovado? tem assunto? tem limite de caracteres?
- **Público por canal**: contato com e-mail e sem telefone é elegível para e-mail e não para SMS. A
  estimativa precisa refletir isso.
- **Métrica por canal**: abertura e clique existem em e-mail e não em WhatsApp; leitura existe em
  WhatsApp e não em e-mail.

## Fora de escopo

- Adapter de SMS (F60-S06) — quando existir, entra por capacidade, sem mudar este código.
- O portão de consentimento: **já funciona para todos os canais** desde a F59-S05.

## Definition of Done

- [x] `campaign_steps` deixa de ser moldado a WhatsApp: ganha `kind` (`wa_template|email|text`), campos de e-mail, e CHECK de coerência por forma.
- [x] E-mail é elegível no criador guiado (`guidedCampaigns: true`), com as capacidades certas — sem modelo aprovado, com sequência e envio de teste.
- [x] Campanha de WhatsApp continua funcionando **exatamente** como hoje: 1046 testes da API verdes, com regressão explícita das mensagens do fluxo F58.
- [x] Nenhuma mensagem de inelegibilidade fala de "número do WhatsApp" quando o canal é outro.
- [x] Validação de modelo aprovado e preflight **pulam** passo sem modelo, em vez de acusar "modelo não está no catálogo" numa campanha de e-mail válida.

**Fica para o slot seguinte** (ver "Escopo entregue"):

- [ ] Wizard da UI montando os passos a partir da capacidade declarada.
- [ ] Estimativa de público excluindo quem não tem o identificador do canal.
- [ ] Métrica por canal (abertura e clique em e-mail; leitura em WhatsApp).

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- Exibir zero onde a métrica não existe é pior que exibir nada: o cliente conclui que a campanha não
  funcionou.
- Regressão do fluxo WhatsApp é obrigatória antes do `finish` — é o que está em produção hoje.

## Escopo entregue (2026-09-09)

**Entregue — a fundação, que é onde estava o bloqueio real:**

O criador de campanhas era WhatsApp-cêntrico em dois níveis: no **schema** (`template_name`
obrigatório em `campaign_steps`) e na **elegibilidade** (`guidedCampaigns: true` só para
`meta_whatsapp`). Enquanto o schema exigisse modelo aprovado, nenhuma UI resolveria — não havia
onde guardar um assunto de e-mail.

Agora `campaign_steps` tem forma declarada (`kind`) com CHECK de coerência, e-mail é elegível, e os
caminhos de validação específicos de WhatsApp pulam o que não tem modelo em vez de reprovar.

**Fica para o slot seguinte:** o wizard da UI, a estimativa de público por canal e a métrica por
canal. Os três são trabalho de superfície que agora tem onde se apoiar — e nenhum deles cabia neste
slot sem repetir o erro do F60-S03 de empurrar meia dúzia de coisas para o fim de um slot longo.

## Decisões tomadas na execução

1. **`kind` + CHECK de coerência, não colunas opcionais soltas.** Um passo de e-mail sem assunto só
   falharia na hora do envio, com a campanha rodando e o cliente esperando. O banco recusa antes.
   É a mesma disciplina que `channels` já usa para exigir `phone_number_id` só no WhatsApp.
2. **`requiresMarketingOptIn: false` para e-mail NÃO significa "pode mandar para qualquer um".**
   Significa que a exigência não é do canal: quem decide é o portão da F59, a partir do market pack.
   Nos EUA o CAN-SPAM dispensa opt-in prévio para e-mail e o TCPA exige para SMS. A flag é dica de
   UI; a regra vive num lugar só.
3. **Instagram e WAHA seguem fora do disparo em massa, agora com o motivo certo.** IG não é limitação
   nossa — a Meta não permite DM em massa. WAHA é não-oficial e disparo em massa derruba a conta do
   cliente. Antes as duas mensagens mandavam "reconectar o número do WhatsApp", o que não fazia
   sentido nenhum.
4. **Validação de modelo filtra na origem, em vez de aceitar `templateName` nulo.** Cheguei a tornar
   o tipo anulável e a mudança se espalhou por quatro arquivos até um porto que devolve
   `Promise<MetaTemplateInfo>`. Recuei: `ValidationStep` descreve passo de WhatsApp, e quem monta a
   lista filtra. O tipo não-nulo é o que impede alguém achar que "sem modelo" é um caso a tratar lá
   dentro.

## Defeito de infraestrutura corrigido: `Hook timed out in 10000ms`

Este sintoma me custou **dois diagnósticos errados** nesta fase — uma vez chamei de "falhas
pré-existentes em main", outra de "só ambiente". Desta vez medi os dois lados:

- isolado: o arquivo passa, com `collect` levando ~19s
- suíte completa: o mesmo hook estoura os 10s e o arquivo falha inteiro

Comparei com `git stash` para descartar regressão: passa igual antes e depois. A causa é o
`hookTimeout` default do Vitest (10s) contra um `beforeAll` que sobe app e abre conexão com
Postgres, Redis e RabbitMQ. Subi para 30s em `@hm/api` e criei o config equivalente em
`@hm/workers`, com o porquê no comentário. **Não é mascarar falha** — o hook faz trabalho real e
demorado, e 10s é um número escolhido sem saber disso.

Depois da correção: `@hm/api` **111 arquivos, 1046 testes, todos verdes**, na suíte completa.
