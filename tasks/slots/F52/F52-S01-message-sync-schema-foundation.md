---
id: F52-S01
title: Schema foundation da sincronização (media_status, provider_timestamp, idempotency_key)
phase: F52
status: done
priority: critical
estimated_size: S
depends_on: [F40-S01]
blocks: [F52-S04, F52-S05, F52-S08]
agent_id: db-engineer
source_docs:
  - docs/features/LIVECHAT.md
completed_at: 2026-06-27T12:25:50Z

---
# F52-S01 — Schema foundation da camada de sincronização

> **Origem:** survey de confiabilidade desta sessão (5 agentes mapearam webhook→inbound→outbound→mídia→flows→socket→UI). Fundação de schema da Fase F52 "Sync Reliability".

## Objetivo

Adicionar à tabela `messages` as três colunas que destravam o endurecimento da camada de mensagens, com migration versionada e idempotente: estado de mídia, timestamp do provider (ordenação fiel) e chave de idempotência de envio.

## Contexto / por quê

Hoje `messages` não distingue mídia "carregando" de "falhou" (frontend mostra placeholder eterno), ordena por `created_at` = hora de inserção (reprocessamento quebra a ordem), e não tem chave de idempotência (redelivery de job outbound envia 2×). Esta fundação é consumida por F52-S04 (idempotência), F52-S05 (mídia) e F52-S08 (ordenação).

## Escopo (faz)

- Adicionar coluna **`media_status`** (enum: `pending | downloading | ready | failed`), nullable; só relevante para mensagens de mídia. Default conforme tipo (mídia inbound nasce `pending`; texto fica `null`).
- Adicionar coluna **`provider_timestamp`** (`timestamptz`, nullable) — instante real do evento no provider (WhatsApp/IG/WAHA), distinto de `created_at` (hora de inserção).
- Adicionar coluna **`outbound_idempotency_key`** (`text`, nullable) + **índice UNIQUE parcial** `where outbound_idempotency_key is not null` (escopado por workspace se o padrão das demais uniques exigir).
- Índice em `(conversation_id, coalesce(provider_timestamp, created_at) desc)` para a query de listagem ordenada (consumida por F52-S08).
- Migration drizzle idempotente; `pnpm --filter @hm/db migrate` aplica limpo.

## Fora de escopo

- Escrever valores nessas colunas (quem escreve: F52-S04 idempotency_key, F52-S05 media_status, F52-S08 provider_timestamp). Este slot só cria estrutura.
- Mudar a query de listagem (F52-S08).
- RLS: `messages` já tem policy; não recriar.

## Arquivos permitidos

- `packages/db/src/schema/messages.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Arquivos proibidos

- `packages/db/src/repos/**` · `apps/**` · `packages/channels/**` · `packages/shared/**`

## Contratos de saída

- Tipos drizzle de `messages` expõem `mediaStatus`, `providerTimestamp`, `outboundIdempotencyKey`.
- Enum `media_status` exportado para uso em workers/shared.

## Definition of Done

- [ ] Migration cria as 3 colunas + índice UNIQUE parcial + índice de ordenação; `pnpm --filter @hm/db migrate` idempotente (rodar 2× não falha).
- [ ] Tipos drizzle refletem as colunas; `pnpm typecheck` verde.
- [ ] Teste de schema/repo confirma insert com as novas colunas e a unique de idempotency_key rejeitando duplicata.
- [ ] `pnpm --filter @hm/db test` + lint verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Depende de **F40-S01** só para sequenciar migrations no mesmo diretório `packages/db/drizzle/**` (evita colisão de journal); F40-S01 é Onda 0 e entra primeiro de qualquer forma.
- Conferir o padrão das uniques existentes (ex.: `uq_messages_external` é parcial `where external_id is not null`) e espelhar o estilo para `outbound_idempotency_key`.
- `media_status` como enum PG (não text) para integridade; default de inbound media decidido no slot que escreve (F52-S05), aqui só o tipo permite os 4 valores.
