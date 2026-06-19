---
id: F39-S03
title: Ingestão de webhooks de coexistência — parse de history / smb_message_echoes / smb_app_state_sync
phase: F39
status: in-progress
priority: high
estimated_size: M
depends_on: [F39-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
blocks: [F39-S04]
claimed_at: 2026-06-19T05:03:36Z

---
# F39-S03 — Ingestão de webhooks de coexistência (parse + publish)

> **source_docs:** `docs/features/LIVECHAT.md` §2.4 (webhook unificado) · Meta WhatsApp Coexistence webhooks (docs públicas — ver Notas)
> **depende de:** F39-S01 (subscribed_apps dos campos de coexistência)

## Objetivo

Reconhecer e parsear, no webhook unificado `/webhooks/meta`, os **campos de coexistência** da WhatsApp Business Account — `smb_message_echoes` (mensagens enviadas pelo app WhatsApp Business), `history` (histórico de contatos/conversas) e `smb_app_state_sync` (estado do número/sessão) — e **publicar eventos tipados** na fila para os workers (F39-S04) processarem. O handler permanece <5s e responde 200.

## Contexto

`apps/api/src/routes/webhooks/meta.ts` hoje valida HMAC + dedup e publica `inbound.message` para `messages`. Os envelopes de coexistência têm shape diferente (echoes/history/app_state) e **não** são reconhecidos. Este slot estende o parser e a publicação — sem implementar a persistência (workers em F39-S04).

## Escopo (faz)

- `packages/channels/src/meta/whatsapp/coexistence.ts` (novo): parsers puros (Zod/narrowing, sem `any`) que extraem de um envelope WA: echoes, batches de history e app_state.
- `packages/channels/src/meta/whatsapp/webhook.parser.ts`: reconhecer os novos `field`s e roteá-los ao parser de coexistência.
- `apps/api/src/routes/webhooks/meta.ts`: ao detectar campos de coexistência (provider `meta_whatsapp`), publicar os eventos tipados correspondentes (dedup na borda já existente).
- `apps/api/src/routes/webhooks/publisher.ts`: novas funções de publish (`publishCoexistenceEcho`, `publishHistoryBatch`, `publishAppState`) — ou um publish genérico tipado.
- `packages/shared/src/mq/topology.ts`: declarar a(s) fila(s)/binding(s) de coexistência se necessário (event kinds novos). **Único slot que edita topology.ts.**

## Fora de escopo

- Persistência (conversas/contatos/estado) e workers — F39-S04. Onboarding/subscription — F39-S01.

## Arquivos permitidos

- `apps/api/src/routes/webhooks/meta.ts`
- `apps/api/src/routes/webhooks/publisher.ts`
- `packages/channels/src/meta/whatsapp/webhook.parser.ts`
- `packages/channels/src/meta/whatsapp/coexistence.ts`
- `packages/shared/src/mq/topology.ts`

## Arquivos proibidos

- `apps/api/src/routes/channels/**` (F39-S01) · `apps/workers/**` (F39-S04)
- `packages/channels/src/meta/whatsapp/adapter.ts` (F39-S01)

## Contratos

- **Saída (eventos publicados):** envelope tipado por tipo — `coexistence.echo` (mensagem do app), `coexistence.history` (batch de contatos/mensagens), `coexistence.app_state` (estado do número). Schema do payload definido aqui e consumido por F39-S04 (contrato fixo via Zod em `@hm/shared`/`@hm/channels`).
- **Dedup:** reusa `registerWebhookEvent` (borda) — eventos repetidos não re-publicam.

## Definition of Done

- [ ] `/webhooks/meta` reconhece `smb_message_echoes`, `history`, `smb_app_state_sync` e publica os eventos tipados; campos desconhecidos continuam com ack 200 sem publicar.
- [ ] Assinatura HMAC e resposta <5s preservadas; `messages` (inbound padrão) inalterado.
- [ ] Parsers cobertos por unit tests (envelopes de exemplo da Meta), sem `any`.
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/channels test` + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/channels test
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Gotcha conhecido de MQ: `assertTopology` NÃO pode setar `deadLetterExchange` (ver memória `leadium-vps-deploy-target` gotcha #4 — quebra os consumers com 406). Ao declarar filas novas aqui, manter `{ durable: true }`.
- Definir o **contrato de payload** com cuidado: F39-S04 depende dele. Preferir tipos em `@hm/channels` reusáveis pelo worker.
