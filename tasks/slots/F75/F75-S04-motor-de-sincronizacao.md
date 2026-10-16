---
id: F75-S04
title: Motor de sincronização incremental, idempotente por ref externa, com retries, reconciliação e teste com amostra
phase: F75
status: blocked
priority: critical
estimated_size: L
model: opus
depends_on: [F75-S01, F75-S02, F75-S03, F75-S05, F73-S02]
blocks: [F75-S06, F75-S08, F75-S10, F75-S12]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md
agent_id: backend-engineer
---
# F75-S04 — Motor de sincronização

## Objetivo

Uma conexão ativa sincroniza sozinha: incremental por cursor, retomável página a página, idempotente por
referência externa (casa por código, nunca por nome), com política de conflito, retries com backoff,
reconciliação diária, erros agrupados por causa, dado velho marcado, e um modo de teste com 5 registros reais que
não grava nada e estima o tamanho do problema na carga completa.

## Contexto

Spec §4.2 e lições L1–L7. Primeiro consumidor do framework (S02), do cofre (S03), do mapeamento (S05) e do schema (S01).

## Escopo (faz)

- Topologia (`packages/shared/src/mq/topology.ts`): filas `hm.q.integrations.sync`, `hm.q.integrations.inbound`
  (consumida pelo S06) e `hm.q.integrations.alerts` (consumida pela API no S08), com DLX no padrão existente e
  routing keys exportadas (`INTEGRATION_ROUTING_KEYS`).
- `apps/workers/src/integrations/index.ts`: `registerIntegrationWorkers(deps)` que liga `sync` e `reencrypt` (S03);
  uma linha em `apps/workers/src/bootstrap/index.ts`.
- `apps/workers/src/integrations/sync/`:
  - **scheduler** (tick 30 s, in-process como os outros): `listDue` (S01) ⇒ publica job `sync.requested` por
    `(connection, entity)` pela outbox; respeita `paused`, `needs_reauth`, `backoff_until`;
  - **lock** por `(connection, entity)` com advisory lock transacional (hash do id) — duas execuções nunca
    concorrem;
  - **execução**: `integration_sync_runs.start` ⇒ `paginate` do S02 com `ctx` real (credencial via vault, rate
    limit distribuído em Redis por conexão `rl:int:<connectionId>`) ⇒ por página: mapping ativo da conexão
    (`applyMapping` do S05) ⇒ validação Zod canônica ⇒
    `upsertByExternalRef` ⇒ commit ⇒ cursor salvo **depois** de aplicar a página; orçamento de 60 s ou
    `maxPagesPerRun` por execução (reagenda imediato se sobrou);
  - `upsertByExternalRef(tx, input)` (spec §4.2 passos 1–4): ref existe ⇒ compara `content_hash` (sem mudança ⇒
    `unchanged`); não existe ⇒ casa por **chave forte** declarada no mapeamento (documento normalizado, e-mail
    minúsculo, telefone E.164 via `phone-normalize` do `@hm/shared`) e **nunca por nome**; senão cria; grava a
    ref; evento de domínio pela outbox na mesma transação (`deal.created`/`deal.won` quando "pedido faturado vira
    negócio ganho" estiver ligado);
  - **conflito** em bidirecional: vence a última alteração; perdedor registrado como `conflict_overwritten`;
  - **erros por registro** viram `syncErrorsRepo.upsertGrouped` com `code`, `cause_pt`, `hint_pt` (catálogo
    `errors-pt.ts`: `customer_not_found`, `missing_sku`, `invalid_email`, `invalid_phone_no_ddd`,
    `required_field_missing`, `invalid_value`, `conflict_overwritten`, `truncated_response`, `remote_error`,
    `auth_failed`), sem derrubar a página;
  - **retries**: transitório/429/5xx ⇒ backoff 1 m, 5 m, 30 m, 2 h com jitter, depois `status='error'`;
    401/403 ⇒ `refresh` (S03) e, falhando, `needs_reauth`; cada mudança de estado publica um job
    `integration.alert` (`{ connectionId, cause, since }`) na fila de alertas (o S08 entrega);
  - **dado velho**: `last_success_at + max_staleness_sec < now()` ⇒ `status='stale'` + alerta;
  - **reconciliação** diária às 03:00 no fuso do workspace: lista IDs da janela, marca `missing_since` nas refs
    ausentes (nunca apaga entidade);
  - **reprocessar**: job `sync.reprocess { connectionId, errorId? }` relê os `sample_external_ids` (ou a janela do
    erro) e resolve o erro se passar;
  - progresso em tempo real para o passo 5 e o painel: evento de socket `integration:sync_progress { connectionId,
    entity, done, total? }` (máx. 1 a cada 500 ms por execução) — registrar em `packages/shared/src/socket-events.ts`.
- **Teste com amostra (dry-run)** — `apps/api/src/services/integrations/test-run.ts` + rota em
  `apps/api/src/routes/integrations/test-run.ts` (arquivo criado vazio pelo S07):
  `POST /api/integrations/connections/:id/test { entity }` roda `sample(n=5)` + mapping + validação + casamento
  **sem gravar** (transação com `ROLLBACK` ou caminho puro), devolve `rows` e `patterns` com `estimatePct`/
  `estimateCount` (contagem do conector quando houver, senão extrapolação marcada como estimativa) e `fixes`
  concretas (ex.: `phone_e164.default_ddd = '11'`, "importar sem telefone e listar para revisão"). Timeout 20 s.
  Schema em `packages/shared/src/integrations/test-run.ts`.

## Fora de escopo

- Webhook de entrada (S06), conectores de referência (S12), painel de saúde (S08).

### files_allowed

- `packages/shared/src/mq/topology.ts`
- `packages/shared/src/socket-events.ts`
- `packages/shared/src/integrations/test-run.ts`
- `apps/workers/src/integrations/index.ts`
- `apps/workers/src/integrations/sync/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/api/src/services/integrations/test-run.ts`
- `apps/api/src/services/integrations/test-run.test.ts`
- `apps/api/src/routes/integrations/test-run.ts`

### files_forbidden

- `packages/db/**` (S01), `packages/integrations/src/mapping/**` (S05)

## Definition of Done

- [ ] teste: duas execuções simultâneas da mesma `(connection, entity)` ⇒ só uma roda
- [ ] teste: processo cai no meio (erro forçado após a página 2) ⇒ retoma da página 3, sem duplicar
- [ ] teste: mesma página aplicada duas vezes ⇒ `unchanged`, zero escrita, zero evento duplicado
- [ ] teste: cliente com nome igual e código diferente ⇒ dois contatos; mesmo CPF e código novo ⇒ casa
- [ ] teste: página truncada sem cursor (fake 500 linhas) ⇒ run `failed` com `truncated_response`, cursor intacto
- [ ] teste: 401 ⇒ refresh ⇒ sucesso; refresh falha ⇒ `needs_reauth` e job de alerta publicado
- [ ] teste: erros agrupados por causa com `occurrences` e amostra ≤ 10
- [ ] teste: dry-run não grava nada (contagem de linhas antes/depois) e estima o padrão de erro
- [ ] teste: `stale` após `max_staleness_sec`
- [ ] typecheck/lint de `@hm/workers`, `@hm/api`, `@hm/shared`

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
pnpm exec eslint apps/workers/src/integrations apps/api/src/services/integrations/test-run.ts apps/api/src/routes/integrations/test-run.ts
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/integrations --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations/test-run.test.ts --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Use os fakes de `@hm/integrations/testing` em todos os testes do motor.
- `bootstrap/index.ts` e `socket-events.ts` são arquivos compartilhados com outras fases: uma linha cada.
- O S06 depois acrescenta `inbound` em `apps/workers/src/integrations/index.ts`.
