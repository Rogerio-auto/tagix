---
id: F69-S03
title: Leads de anúncios — do formulário à inbox em segundos, com prova de consentimento
phase: F69
status: available
priority: critical
estimated_size: L
depends_on: [F69-S02]
blocks: [F69-S06]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer

---
# F69-S03 — Leads de anúncios — do formulário à inbox em segundos, com prova de consentimento

## Objetivo

Todo lead de formulário de anúncio da Meta vira, em segundos, contato + conversa + card no funil + aviso de lead novo — com o texto de consentimento guardado como prova.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §5.1–5.3. É o caso de uso que o cliente sente no primeiro dia: o anúncio gera o lead e ele chega antes de o concorrente responder. Hoje o webhook `/webhooks/meta` descarta o objeto `page`, que é onde o `leadgen` chega. A Meta guarda o dado do formulário por 90 dias; perder a busca é perder um lead pago sem aviso. Permissões: `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management` (conferir no painel do app antes de submeter).

## Escopo

### files_allowed

- `apps/api/src/routes/webhooks/meta.ts`
- `apps/api/src/routes/webhooks/*.test.ts`
- `packages/channels/src/meta/leadgen/**`
- `apps/workers/src/leadgen/**`
- `apps/workers/src/bootstrap/index.ts`
- `packages/shared/src/mq/topology.ts`
- `packages/db/src/schema/lead_ad_submissions.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/api/src/services/meta/leadgen/**`
- `apps/web/features/lead-ads/**`
- `apps/web/app/(app)/settings/meta/**`

### files_forbidden

- `packages/shared/src/consent.ts`
- `apps/workers/src/outbound/**`

## Escopo (faz)

- Assinatura da página no campo `leadgen` a partir da conexão (F69-S02).
- Webhook aceita objeto `page` / campo `leadgen` no mesmo caminho de assinatura, deduplicação e fila.
- Worker busca o lead pelo `leadgen_id` **imediatamente**, com retry e alerta; reconciliação periódica por formulário para o que o webhook não entregou.
- Mapeamento de campos do formulário para contato (nome, telefone E.164, e-mail) e para campos do funil do blueprint do workspace.
- Cria conversa, card no funil com origem (campanha, conjunto, anúncio, formulário) e dispara `lead_novo` pelo roteador da F61-S04.
- Texto de consentimento do formulário gravado como `proof` em `contact_consents` (F59-S03), com data e formulário de origem.
- Tela de configuração: quais páginas e formulários entram, e o mapeamento de campos.

## Fora de escopo

- Resposta automática ao lead (usa agentes e flows existentes).
- Envio da conversão de volta para a Meta (F69-S06).

## Definition of Done

- [ ] Lead chega à inbox em menos de 10s do webhook em ambiente de teste da Meta.
- [ ] Webhook de lead duplicado não cria contato nem card duplicado.
- [ ] Falha na busca faz retry e, esgotado, alerta — nunca some em silêncio.
- [ ] Reconciliação recupera lead que o webhook não entregou.
- [ ] Consentimento do formulário vira `proof` com texto, data e formulário.
- [ ] Telefone normalizado para E.164 com a regra conservadora da F58-S08.
- [ ] Aviso de lead novo sai pelo roteador da F61-S04, sem conteúdo do lead na tela bloqueada.
- [ ] RLS e isolamento por workspace testados.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o dono vê o lead do anúncio no celular antes de o concorrente responder o dele.
- O screencast de App Review desta permissão é gravado a partir deste fluxo (F69-S10).
