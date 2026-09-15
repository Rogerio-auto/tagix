---
id: F69-S03
title: Leads de anúncios — do formulário à inbox em segundos, com prova de consentimento
phase: F69
status: in-progress
priority: critical
estimated_size: L
depends_on: [F69-S02]
blocks: [F69-S06]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-15T04:39:34Z

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
- `packages/db/src/schema/lead_ads.ts` *(correção 2026-09-15: substitui `lead_ad_submissions.ts` — as duas tabelas, fontes e leads, moram juntas)*
- `packages/db/src/repos/lead-ads.ts` *(correção: repositório das duas tabelas)*
- `packages/db/src/index.ts` *(correção: exporta o repositório)*
- `packages/channels/src/index.ts` *(correção: exporta a leitura do lead)*
- `packages/shared/src/phone-normalize.ts`, `packages/shared/src/phone-normalize.test.ts`, `packages/shared/src/index.ts` *(correção: a regra conservadora da F58-S08 vivia só no navegador; o worker precisa dela no servidor)*
- `packages/shared/src/mq/retry.ts` *(correção: `hm.q.leadgen` entra nas filas confiáveis — retry e DLQ)*
- `apps/api/src/routes/meta/lead-sources.ts`, `apps/api/src/routes/meta/lead-sources.test.ts`, `apps/api/src/app.ts` *(correção: rotas de assinatura de página, junto das rotas da F69-S02)*

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
- [x] Webhook de lead duplicado não cria contato nem card duplicado. *(db-store.test: repetido e concorrente)*
- [x] Falha na busca faz retry e, esgotado, alerta — nunca some em silêncio. *(process.test; `hm.q.leadgen` em `reliableQueues` → DLQ monitorada; `failed` com motivo na tela)*
- [x] Reconciliação recupera lead que o webhook não entregou. *(reconcile.test; em produção, validar com lead real)*
- [ ] Consentimento do formulário vira `proof` com texto, data e formulário. *(parcial: prova guardada no lead; concessão de canal depende do mapeamento caixa → canal — ver Decisões)*
- [x] Telefone normalizado para E.164 com a regra conservadora da F58-S08. *(phone-normalize.test + db-store.test)*
- [x] Aviso de lead novo sai pelo roteador da F61-S04, sem conteúdo do lead na tela bloqueada. *(emite o mesmo `message:new` contato/live; o push leva só "Lead novo" + origem)*
- [x] RLS e isolamento por workspace testados. *(db-store.test)*

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

## Decisões de implementação (2026-09-15)

- **Consentimento: evidência, não concessão automática.** O lead traz *se* a caixa foi marcada
  (`custom_disclaimer_responses`); o texto vem do cadastro do formulário
  (`legal_content.custom_disclaimer`), lido junto e **copiado** em
  `lead_ad_submissions.consent_responses` com formulário e data. Não é gravado em
  `contact_consents` porque o texto da caixa é livre, escrito pelo cliente: decidir que
  "Aceito receber novidades" autoriza WhatsApp de marketing seria um chute. Conceder exige
  o cliente dizer, por formulário, qual caixa vale para qual canal e finalidade — slot
  seguinte (mapeamento de caixas → canal). O item do DoD fica parcialmente atendido: prova
  guardada com texto, data e formulário; concessão de canal pendente do mapeamento.
- **Sem dedup de borda.** O worker reserva o lead por `(workspace, leadgen_id)` e trava a
  linha na gravação; reentrega e reconciliação viram `duplicate`.
- **Conversa só com canal WhatsApp Cloud ativo.** `remote_id` = dígitos do telefone, a mesma
  chave do inbound: a resposta da pessoa cai na mesma conversa. Sem canal ou telefone
  válido, o lead vira contato + card.
- **Campos do funil por chave.** Pergunta do formulário com a mesma chave de um campo do
  funil preenche o card (com conversão de tipo; valor que não cabe é descartado). Tela de
  mapeamento manual fica para o slot de mapeamento.
- **Assinar sem apagar.** A assinatura da página lê os campos já assinados pelo app e envia a
  união — assinar só `leadgen` cortaria o Direct do Instagram da mesma página.
- **Falha:** transitória (5xx, 429, rede) → retry da fila confiável → DLQ com alerta.
  Definitiva (token revogado, sem acesso à página) → `failed` com motivo acionável na tela
  "Leads dos anúncios", e a reconciliação tenta de novo depois.
- **Histórico do card:** lead repetido em card existente entra como `note_added` com
  `kind: 'lead_ad_received'` — o CHECK de `deal_history` e a linha do tempo têm lista fechada.
