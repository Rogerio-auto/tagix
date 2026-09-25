---
id: F70-S05
title: Atribuição de anúncio no contato e no deal
phase: F70
status: blocked
priority: high
estimated_size: S
depends_on: [F70-S03]
blocks: [F70-S06]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-09-atribuicao-de-anuncio-no-contato-e-no-deal.md
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

- [ ] teste com payload real de click-to-WhatsApp
- [ ] migração aplicada com backup antes
- [ ] campos visíveis na API v1
