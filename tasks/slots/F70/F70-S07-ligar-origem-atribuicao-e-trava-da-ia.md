---
id: F70-S07
title: Ligar origem, atribuição e eco do IG no pipeline; IA só com origem comprovada
phase: F70
status: in-progress
priority: critical
estimated_size: M
depends_on: [F70-S04, F70-S05]
blocks: [F70-S06]
source_docs:
  - tasks/slots/F70/F70-S04-eco-do-app-vira-mensagem-humana-e-pausa-a-ia.md
  - tasks/slots/F70/F70-S05-atribuicao-de-anuncio-no-contato-e-no-deal.md
agent_id: backend-engineer
claimed_at: 2026-09-25T02:42:27Z

---
# F70-S07 — Ligar origem, atribuição e eco do IG no pipeline; IA só com origem comprovada

> Sub-slot da F70: o que a S04 e a S05 construíram e deixaram fora da fronteira de arquivos.

## Objetivo

A atribuição de anúncio chegar de fato ao contato e ao deal, o eco do Instagram ser persistido e, principalmente, **a IA nunca responder uma conversa sem origem comprovada**. O número do Rogério é pessoal: família e contatos antigos não podem receber resposta automática.

## Contexto

- S05 entregou `parseWhatsAppReferral`, `parseInstagramReferral`, `adReferralFromInboundEvent`, `toAdAttributionColumns`, `classifyConversationOrigin`, `isAiEligibleOrigin` (em `packages/channels/src/meta/whatsapp/`) e as colunas `ad_*` em `contacts`/`deals` (migração 0082). Nada disso está ligado: o pacote não exporta, o inbound não grava, o flow não consulta.
- S04 entregou `parseInstagramEchoes` + `handleInstagramEchoes` e `planHumanReply` (cópia da regra de pausa da API em `apps/workers/src/coexistence/human-takeover.ts`). O webhook/inbound ainda descartam o eco do IG.

## Escopo

### files_allowed

- `packages/channels/src/index.ts`
- `apps/workers/src/inbound/**`
- `apps/workers/src/coexistence/**`
- `apps/api/src/routes/pipeline/deal-conversation.ts`
- `apps/api/src/routes/deals/crud.ts`
- `apps/api/src/routes/webhooks/meta.ts`
- `apps/api/src/routes/conversations/messages.ts`
- `packages/shared/src/**`
- `packages/flow-engine/src/**`
- `packages/db/src/schema/conversations.ts`
- `packages/db/drizzle/**`

## Escopo (faz)

1. Exportar do `@hm/channels` o que a S04 e a S05 criaram.
2. Inbound WA e IG: gravar `toAdAttributionColumns(ref)` no contato **só se `ad_referred_at IS NULL`** (primeiro toque); `referral` do IG no metadata da mensagem.
3. Deal criado a partir da conversa copia a atribuição da primeira mensagem inbound com referral.
4. Origem da conversa: coluna `origin` em `conversations` (migração aditiva, CHECK com os 5 valores), preenchida na criação por `classifyConversationOrigin`; a etiqueta correspondente aplicada ao contato.
5. **Trava da IA:** o handler `ai_action` ACTIVATE do flow-engine recusa (sem erro, com log/evento) quando `!isAiEligibleOrigin(conversation.origin)`. Conversa sem origem gravada conta como `sem-origem` (fail-closed).
6. Eco do Instagram ligado no pipeline (`parseInstagramEchoes` → `handleInstagramEchoes`).
7. `planHumanReply` movido para `@hm/shared`, usado pela API e pelo worker (uma regra só).

## Fora de escopo

- Marcadores de botão do site/Instagram configuráveis por workspace na UI (por ora: config/metadata do workspace, lido com default vazio → nada vira `origem:site` por engano).
- Backfill de referrals antigos.

## Definition of Done

- [ ] teste: conversa `sem-origem` com flow `ai_action ACTIVATE` → IA continua `off`
- [ ] teste: conversa de anúncio → IA ativa; contato e deal com `ad_*`
- [ ] teste: segundo anúncio não sobrescreve o primeiro toque do contato
- [ ] teste: eco do IG persistido como membro e pausa a IA
- [ ] migração aplicada num banco local
