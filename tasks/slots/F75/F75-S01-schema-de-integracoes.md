---
id: F75-S01
title: Schema de integrações com conexões, cofre, sync, refs externas e webhook de entrada, com RLS
phase: F75
status: blocked
priority: critical
estimated_size: L
model: opus
depends_on: [F73-S01]
blocks: [F75-S03, F75-S04, F75-S05, F75-S07]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md
agent_id: db-engineer
---
# F75-S01 — Schema de integrações

## Objetivo

O banco passa a representar integrações de verdade: conexões por empresa, credenciais cifradas com versão de
chave, estado e execuções de sincronização, erros agrupados por causa, referências externas por código (texto,
com filial), mapeamentos versionados, endpoints e eventos de webhook de entrada, pedidos e "Avise-me". Tudo com
RLS desde a migração.

## Contexto

Base de toda a F75 (spec §5, ADR-005 §3–§4). Migrações são sequenciais: este slot vem **depois** do F73-S01
(schema do Copiloto). Número da migração: **próxima livre** em `packages/db/drizzle/meta/_journal.json` (hoje a
última é `0096`; com o F73-S01 deve ser `0098`+). Não fixar o número antes de conferir.

## Escopo (faz)

- `packages/db/src/schema/integrations.ts` com as 12 tabelas da spec §5, exatamente com as colunas, CHECKs e
  índices de lá:
  `integration_connections`, `integration_credentials`, `integration_oauth_states`, `integration_sync_states`,
  `integration_sync_runs`, `integration_sync_errors`, `external_refs`, `integration_field_mappings`,
  `integration_inbound_endpoints`, `integration_inbound_events`, `integration_requests`, `integration_interest`.
- Toda tabela: `workspace_id uuid not null`, FK composta por workspace para `connection_id` (padrão F70-S12:
  `(workspace_id, connection_id) → integration_connections(workspace_id, id)`), `ENABLE` + `FORCE ROW LEVEL
  SECURITY` e policy `<tabela>_isolation` com `app_current_workspace()` (padrão da `0094`), entrada em
  `RLS_TABLES` (`packages/db/src/schema/index.ts`).
- `external_refs`:
  - `external_id text not null` e `external_scope text not null default ''`;
  - único `(workspace_id, connection_id, entity_type, external_scope, external_id)` e índice
    `(workspace_id, entity_type, entity_id)`;
  - triggers `AFTER DELETE` em `contacts`, `deals` e `products` que apagam as refs da entidade
    (`entity_type` correspondente), com teste.
- `integration_inbound_endpoints.endpoint_key` único **global**; função
  `integration_endpoint_lookup(p_key text)` `SECURITY DEFINER` (dona: papel de migração, `search_path` fixo)
  que devolve só `(endpoint_id, workspace_id, connection_id, secret_hash, secret_hash_prev, prev_valid_until,
  require_signature, status)`. É o único acesso fora de RLS (como o aceite de convite). `GRANT EXECUTE` a `hm_app`.
- Função `integration_request_count(p_normalized_name text) returns integer` `SECURITY DEFINER`: conta pedidos
  de **todas** as empresas para o nome normalizado e devolve só o número (spec T10).
- `llm_usage_logs_request_type_chk` ganha `'evaluation'` e `'integration_mapping'`. **Bug achado em 16/10:** o
  `app/routes/evaluate.py` grava `request_type='evaluation'`, que o CHECK atual rejeita; o custo do juiz está
  sendo perdido em silêncio. Atualizar `packages/db/src/schema/llm.ts` junto. O F73-S01 também mexe nesse
  CHECK (tipos do Copiloto): partir da lista que ele deixou e só acrescentar; se ele já incluiu `evaluation`, não
  duplicar.
- Repos em `packages/db/src/repos/integrations.ts` e `packages/db/src/repos/external-refs.ts` (exportados por
  `@hm/db`), todos recebendo `tx` do `withWorkspace`:
  - `integrationConnectionsRepo`: `createDraft`, `findById`, `listByWorkspace`, `updateWizardState`,
    `setStatus`, `activate`, `listDue(now, limit)` (para o scheduler; caminho de workers), `countActive`;
  - `integrationCredentialsRepo`: `upsert(kind, ciphertext, keyVersion, fingerprint, expiresAt)`,
    `getCiphertext` (só para `@hm/integrations/vault`), `deleteByConnection`, `listStaleKeyVersion(current, limit)`;
  - `syncStateRepo`, `syncRunsRepo` (`start`, `finish`, `listRecent`), `syncErrorsRepo` (`upsertGrouped` por
    `(connection, entity, code)` com `occurrences += n` e amostra ≤ 10, `resolve`, `listOpen`);
  - `externalRefsRepo`: `find(connection, entityType, scope, externalId)`, `insert`, `touch(contentHash,
    sourceUpdatedAt)`, `markMissing`, `listByEntity(entityType, entityId)`;
  - `fieldMappingsRepo` (`activeFor`, `createVersion`), `inboundEndpointsRepo` (`create`, `lookupByKey` via a
    função, `rotate`, `disable`), `inboundEventsRepo` (`insertIdempotent` com `ON CONFLICT DO NOTHING`,
    `markProcessed`, `purgeTestOlderThan`), `integrationRequestsRepo` (`create`, `countByName`),
    `integrationInterestRepo` (`register` idempotente).
- Testes: RLS de **cada** tabela entre dois workspaces em `rls.test.ts`; unicidade de `external_refs` com
  `"000123"` ≠ `"123"` e com dois `external_scope`; triggers de delete; idempotência do inbound; lookup de endpoint
  devolve o workspace certo e nada mais; contagem entre empresas devolve só número.

## Fora de escopo

- Cifra e keyring (S03), qualquer rota (S07+), qualquer worker (S04+).
- Colunas novas em `contacts`/`deals`/`products` (decisão do ADR-005 §4: não há).

### files_allowed

- `packages/db/src/schema/integrations.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/llm.ts`
- `packages/db/drizzle/**`
- `packages/db/src/repos/integrations.ts`
- `packages/db/src/repos/external-refs.ts`
- `packages/db/src/repos/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/rls.test.ts`
- `packages/db/src/integrations.test.ts`

### files_forbidden

- `apps/**`
- `packages/db/src/crypto.ts` (S03)

## Definition of Done

- [ ] migração na próxima numeração livre, idempotente (`IF NOT EXISTS`/`DROP POLICY IF EXISTS`), aplicada no dev
- [ ] 12 tabelas com RLS `ENABLE`+`FORCE` e teste de isolamento entre dois workspaces para cada uma
- [ ] FKs compostas por workspace; teste: ref apontando para conexão de outra empresa falha
- [ ] `external_id` texto preserva zero à esquerda; teste com `000123`/`123` e duas filiais
- [ ] triggers de delete em `contacts`/`deals`/`products` testados
- [ ] `integration_endpoint_lookup` e `integration_request_count` testadas (não vazam colunas além das listadas)
- [ ] CHECK de `llm_usage_logs.request_type` aceita `evaluation` e `integration_mapping` (teste de insert)
- [ ] repos exportados por `@hm/db`, com teste do caminho feliz de cada um
- [ ] typecheck de `@hm/db`, `@hm/api` e `@hm/workers` verde

## Validação

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/rls.test.ts src/integrations.test.ts --maxWorkers=1
```

## Notas

- Agente: `db-engineer`. Schema é sequencial: nenhum outro slot da F75 toca `packages/db/**` (exceto o S03 em
  `crypto.ts`). Precisou de coluna depois? Volta para cá via `tasks/COMMS.md` ou abre sub-slot.
- Os repos não decifram nada; `getCiphertext` devolve o texto cifrado e o nome do método deixa claro que só o
  vault o usa.
