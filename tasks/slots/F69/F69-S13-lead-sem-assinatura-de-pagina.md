---
id: F69-S13
title: Receber lead sem assinar a página — modo reconciliação enquanto o App Review não sai
phase: F69
status: review
priority: critical
estimated_size: S
depends_on: [F69-S03]
blocks: []
source_docs:
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer
claimed_at: 2026-09-22T16:04:28Z
completed_at: 2026-09-22T16:18:46Z

---
# F69-S13 — Receber lead sem assinar a página

## Objetivo

O cliente cadastra a página e os leads começam a entrar pela reconciliação (até 15 min), mesmo sem
a permissão que assina a página no webhook. Quando a permissão sair, a mesma página passa a receber
em segundos, sem recadastrar nada.

## Contexto

Descoberto em 2026-09-22, ao criar a configuração do Login for Business (F69-S12): **o app não tem
`pages_manage_metadata` nem em acesso padrão** — no painel, o caso de uso "Capturar e gerenciar leads
de anúncios" só oferece "Adicionar à análise do app". É a permissão de
`POST /{page}/subscribed_apps` (`apps/api/src/routes/meta/lead-sources.ts`), ou seja, **assinar a
página no campo `leadgen`**.

Consequência que muda o plano: sem ela **não chega webhook de lead nem para quem tem função no app**.
Adicionar o cliente como testador não contorna. O App Review virou pré-requisito da F69-S03 rodar
**uma vez**, não do segundo cliente.

**Mas existe caminho, e a própria Meta o documenta.** Em [Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving)
(conferido em 2026-09-22), ler lead por `GET /{form_id}/leads` / `GET /{leadgen_id}` exige
`ads_management`, `leads_retrieval`, `pages_show_list`, `pages_read_engagement` e `pages_manage_ads`,
com token de página ou de usuário de quem pode anunciar na conta — e `pages_manage_metadata` aparece
lá como necessária **apenas "if using webhooks"**. As cinco **estão** na configuração criada
(F69-S12). A reconciliação da F69-S03 já faz exatamente essa leitura, a cada 15 min.

O que impede é a rota de cadastro: hoje ela exige a assinatura para gravar a fonte. Sem assinatura,
não há fonte; sem fonte, a reconciliação não olha a página.

Diferença para o cliente: lead em **até 15 minutos** em vez de segundos. Pior que o prometido, muito
melhor que não receber — e reversível no dia em que a permissão sair.

## Escopo

### files_allowed

- `apps/api/src/routes/meta/lead-sources.ts`
- `apps/api/src/routes/meta/lead-sources.test.ts`
- `packages/db/src/schema/lead_ads.ts`
- `packages/db/src/repos/lead-ads.ts`
- `packages/db/src/index.ts` *(correção 2026-09-22: exporta o tipo do modo de entrega para a API e a tela)*
- `packages/db/drizzle/**`
- `apps/web/features/lead-ads/**`
- `docs/features/META_INTEGRACAO_PLAN.md`

### files_forbidden

- `apps/workers/src/leadgen/**` — a reconciliação já faz o trabalho; nada a mudar lá.

## Escopo (faz)

- Cadastrar a página como fonte mesmo quando `subscribed_apps` falha por permissão ausente: grava a
  fonte em modo **reconciliação** (`delivery = 'reconciliation' | 'webhook'`), em vez de recusar.
- Falha por outro motivo (token revogado, página de terceiro, Meta fora) continua recusando — o modo
  degradado é só para a permissão que falta.
- Tela "Leads dos anúncios" mostra o modo por página, em linguagem de dono: "recebendo em segundos"
  × "conferindo a cada 15 minutos — aguardando liberação da Meta", com o que destrava.
- Botão para tentar assinar de novo (quando a permissão for aprovada) e promover a fonte a `webhook`
  sem recadastrar.
- Primeira conferência de uma fonte nova em modo reconciliação olha 24h para trás (já é o padrão),
  então o lead de teste anterior ao cadastro entra.

## Fora de escopo

- Reduzir o intervalo de 15 min (é limite de chamada da Meta, não de código).
- App Review em si — é a F69-S10.

## Definition of Done

- [ ] Página cadastra em modo reconciliação quando falta `pages_manage_metadata`; a fonte fica ativa.
- [ ] Lead do formulário entra pela reconciliação, sem webhook (teste com a Graph falsa).
- [ ] Falha que não é de permissão continua recusando o cadastro.
- [ ] Tela diz o modo de cada página e o que falta para os segundos.
- [ ] Assinar de novo promove a fonte para `webhook` sem recadastrar.

## Validação

```bash
pnpm --filter @hm/api test
pnpm --filter @hm/web test
pnpm typecheck
pnpm lint
```

## Notas

- Quando a permissão sair, a promoção é o caminho: não recadastrar página, não perder histórico.
- O `leadgen_id` do webhook e o da reconciliação caem na mesma reserva por `(workspace, leadgen_id)`,
  então ligar o webhook depois não duplica nada.
