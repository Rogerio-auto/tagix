---
id: F70-S05
title: Atribuição de anúncio no contato e no deal
phase: F70
status: in-progress
priority: high
estimated_size: S
depends_on: [F70-S03]
blocks: [F70-S06]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-09-atribuicao-de-anuncio-no-contato-e-no-deal.md
agent_id: backend-engineer
claimed_at: 2026-09-25T01:43:23Z

---
# F70-S05 — Atribuição de anúncio no contato e no deal

> Espelho do **CO-09** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

Toda conversa que veio de anúncio saber de qual anúncio veio.

## Contexto

O parser do WhatsApp não lê `messages[].referral`; `ctwa_clid` e `source_id` se perdem (o payload cru dura só 30 dias em `webhook_events`). O IG guarda `referral` só em `messages.metadata`.

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/**`
- `packages/channels/src/meta/instagram/**`
- `packages/db/src/schema/**`
- `packages/db/drizzle/**`
- `apps/api/src/routes/v1/**`

## Escopo (faz)

- Parser WA: extrair `referral` (`source_id`, `source_type`, `source_url`, `headline`, `ctwa_clid`).
- Migração: colunas de origem de anúncio em `contacts` (primeiro toque) e em `deals` (número da migração conferido no journal na hora do claim).
- IG: mover o `referral` para os mesmos campos.
- Expor os campos na API v1 (contatos e deals).
- Etiquetas automáticas de origem: `origem:anuncio`, `origem:site`, `origem:instagram`, `origem:prospeccao` (F70-S04), `sem-origem`.
- **Regra crítica, porque o número é pessoal:** a IA só é ativada em conversa com origem comprovada. `sem-origem` nunca recebe resposta da IA.

## Fora de escopo

- Devolver conversão para a Meta (F69-S06).

## Definition of Done

- [x] teste com payload real de click-to-WhatsApp *(fixture no formato da doc da Meta em `ad-referral.fixtures.ts`; captura do número real depende da F70-S03)*
- [ ] migração aplicada com backup antes *(0082 gerada; aplicação em produção é passo do orchestrator, com backup)*
- [x] campos visíveis na API v1 *(`adAttribution` em contatos e deals + filtro `adSourceId`; OpenAPI atualizado)*

## Validação

```bash
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/channels exec vitest run src/meta/whatsapp src/meta/instagram
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db exec vitest run src/schema/ad-attribution.test.ts
pnpm --filter @hm/api exec vitest run src/routes/v1/ad-attribution.test.ts
python scripts/slot.py check-migrations
```

## Notas

- Migração **0082_f70_ad_attribution** (aditiva): 9 colunas `ad_*` nullable em `contacts` e `deals`,
  CHECK de canal e de tudo-ou-nada (`ad_channel`/`ad_source_type`/`ad_referred_at`), índice parcial
  `(workspace_id, ad_source_id) WHERE ad_source_id IS NOT NULL`. RLS existente cobre as colunas.
- `contacts` = primeiro toque (writer grava só com `ad_referred_at IS NULL`); `deals` = anúncio da
  oportunidade (o `ctwa_clid` do deal alimenta a F69-S06).
- Referral normalizado (`AdReferral`) vai em `metadata.adReferral` das mensagens WA e IG.
- Wiring fora da fronteira (pendente, ver relatório do slot): exports no `packages/channels/src/index.ts`,
  gravação das colunas no worker inbound (`apps/workers/src/inbound/**`), etiqueta de origem e gate do
  `ai_action ACTIVATE` (`packages/flow-engine`).
