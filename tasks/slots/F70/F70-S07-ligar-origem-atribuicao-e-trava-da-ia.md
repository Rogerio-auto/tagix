---
id: F70-S07
title: Ligar origem, atribuição e eco do IG no pipeline; IA só com origem comprovada
phase: F70
status: done
priority: critical
estimated_size: M
depends_on: [F70-S04, F70-S05]
blocks: [F70-S06]
source_docs:
  - tasks/slots/F70/F70-S04-eco-do-app-vira-mensagem-humana-e-pausa-a-ia.md
  - tasks/slots/F70/F70-S05-atribuicao-de-anuncio-no-contato-e-no-deal.md
agent_id: backend-engineer
claimed_at: 2026-09-25T02:42:27Z
completed_at: 2026-09-25T03:42:03Z

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

- [x] teste: conversa `sem-origem` com flow `ai_action ACTIVATE` → IA continua `off`
  *(`apps/workers/src/inbound/origin-gate.test.ts`: handler real + port real no Postgres dev; também NULL/legado e `prospeccao` em `packages/flow-engine/src/ports/outbound.port.test.ts`)*
- [x] teste: conversa de anúncio → IA ativa; contato e deal com `ad_*`
  *(IA + contato: `origin-gate.test.ts`. Deal: `loadConversationAdAttribution` + `ensureDealForConversation` provados contra o Postgres dev com um teste temporário, porque arquivo de teste da API está fora de `files_allowed` (ver Pendências))*
- [x] teste: segundo anúncio não sobrescreve o primeiro toque do contato
- [x] teste: eco do IG persistido como membro e pausa a IA *(pipeline inbound real: DM de anúncio → IA on → webhook com `is_echo` → mensagem `member`, `metadata.origin='app'`, `ai_mode='paused'`/`human_takeover`)*
- [x] migração aplicada num banco local *(0083 no Postgres dev `localhost:5442`; coluna e CHECK conferidos)*

## Decisões

- **Migração 0083_f70_conversation_origin** (aditiva): `conversations.origin text` nullable + CHECK
  com os 5 valores (`origem:anuncio|site|instagram|prospeccao`, `sem-origem`). Sem backfill e sem
  índice (a trava consulta pela PK). NULL = `sem-origem` na leitura (`normalizeConversationOrigin`).
- **Origem decidida uma vez, na criação**, gravada no próprio INSERT da conversa (a trava vale desde
  o primeiro instante). Conversa existente nunca é reclassificada: um contato antigo que clica num
  anúncio continua `sem-origem` até um humano ligar a IA à mão (fail-closed).
  - inbound WA/IG/WAHA: `classifyConversationOrigin` com o primeiro referral do lote, o texto da
    primeira mensagem e os marcadores do workspace;
  - comentário do IG (`comment_thread`): classificado pelo canal → `origem:instagram`;
  - eco do app que abre a conversa: `origem:prospeccao`;
  - import de histórico da coexistência: `sem-origem` (são exatamente os contatos antigos).
  A etiqueta de mesmo nome vai para o CONTATO na criação (etiquetas são de contato no schema).
- **Marcadores de botão**: `workspaces.settings.originPrefillMarkers = { site: string[], instagram: string[] }`,
  validado com Zod (`originPrefillMarkersFromSettings`, `@hm/shared`); ausente/inválido → listas
  vazias. Só é lido no caminho de criação de conversa.
- **Trava atômica**: `setConversationAi('on')` do port de outbound da flow-engine é
  `UPDATE ... WHERE id = $1 AND origin IN (<elegíveis>)`. Sem janela entre ler e ligar; NULL não
  está no IN. Os elegíveis vêm de `isAiEligibleOrigin` (`@hm/channels`), uma regra só, e um assert
  de tipo quebra o build se o domínio de `@hm/shared` e o de `@hm/channels` divergirem. O port
  devolve `{ applied:false, reason:'origin_not_eligible' }`; o handler `ai_action` loga `warn` e
  devolve `SUCCESS` com a variável `ai_activation_blocked` (o flow segue e pode ramificar).
  `TRANSFER` também liga a IA e passa pela mesma trava; `DEACTIVATE` nunca é travado.
- **Primeiro toque**: `recordFirstTouchAttribution` grava `toAdAttributionColumns(ref)` com
  `WHERE ad_referred_at IS NULL` a cada lote inbound com referral (idempotente sob reentrega).
- **Deal**: `loadConversationAdAttribution` (primeira mensagem inbound com `metadata.adReferral`,
  ordem `coalesce(provider_timestamp, created_at)`, revalidada com `readAdReferral`) alimenta o
  INSERT de `ensureDealForConversation` e do `POST /api/deals` com `conversationId`.
- **IG referral avulso** (`messaging[].referral`): além do cru, vai normalizado em `metadata.adReferral`.
- **Eco do IG**: passo `instagramEchoes` do pipeline inbound (mesmo payload que a borda já publica e
  deduplica), ANTES do inbound e do early-return, para a pausa valer antes de o inbound decidir
  enfileirar a IA. Falha no passo loga e não derruba o inbound. `meta.ts` não precisou mudar.
- **`planHumanReply` em `@hm/shared`**: API e worker usam a mesma função. A API continua sem ler
  `first_response_at` (passa `null` e protege com `coalesce(..., now())` no SQL), então o
  comportamento dela é idêntico ao anterior (testes F30-S04 passam sem alteração).

## Caminhos que ligam `ai_mode='on'` (auditoria)

| Caminho | Tipo | Tratamento |
| --- | --- | --- |
| flow `ai_action` ACTIVATE/TRANSFER (port de outbound da `flow-engine`) | automático | **travado** (UPDATE condicional na origem) |
| handoff de campanha (`campaigns-inbound` `handoffToAgent`) | automático | **travado**: a composição do inbound envolve os ports com `gateCampaignAiHandoff` → mesmo port |
| retomada por `ai_resume_at` (`agents/reengagement.ts`) | automático | só retoma conversa `paused`, que já esteve `on` por caminho travado ou manual. Fora da fronteira; sem mudança |
| tool de transferência IA→IA (`api/internal/tools/agent-transfer-handlers.ts`) | automático | só roda dentro de uma execução de agente, que exige `ai_mode='on'`. Fora da fronteira; sem mudança |
| `PATCH /conversations/:id/state` e `POST /conversations/:id/agent` | manual (humano) | permitido por decisão |
| criação de conversa (inbound, eco, histórico, comment thread) | n/a | sempre nasce `off`; não existe default de canal/workspace que ligue a IA |

O worker de agentes (`agents/run.ts`) só responde com `ai_mode='on'`, então a lista acima cobre
toda forma de a IA falar sozinha.

## Pendências fora da fronteira

- Teste permanente da cópia de atribuição para o deal na API (`apps/api/src/routes/pipeline/*.test.ts`
  fora de `files_allowed`). A prova foi feita com um teste temporário contra o Postgres dev
  (primeiro referral por horário do provider vence; conversa sem referral → deal sem `ad_*`).
- `campaigns-inbound/db-ports.ts` ainda tem o `handoffToAgent` cru (UPDATE sem trava). Não está mais
  ligado em produção (a composição usa o travado), mas o ideal é trocá-lo pelo port da engine.
- `agents/reengagement.ts` e `agent-transfer-handlers.ts` podem checar a origem como defesa em
  profundidade (hoje dependem de a conversa já ter estado `on` de forma legítima).
- UI para configurar `originPrefillMarkers` e para mostrar a recusa (`ai_activation_blocked`).

## Validação

```bash
pnpm --filter @hm/shared exec vitest run src/human-reply.test.ts src/conversation-origin.test.ts
pnpm --filter @hm/flow-engine exec vitest run
pnpm --filter @hm/workers exec vitest run src/inbound src/coexistence src/campaigns-inbound
pnpm --filter @hm/api exec vitest run src/routes/conversations/messages.test.ts src/routes/deals src/routes/pipeline
pnpm -r typecheck
python scripts/slot.py check-migrations
```
