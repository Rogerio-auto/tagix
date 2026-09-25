---
id: F70-S24
title: Outbox confere envelope e fila contra o workspace, retenção configurável e event_id por workspace
phase: F70
status: available
priority: medium
estimated_size: S
depends_on: [F70-S25]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S16-outbox-transacional.md
---
# F70-S24 — Outbox confere envelope e fila contra o workspace

> Segunda auditoria de segurança pré-deploy (25/09): MEDIUM-3, L-d e L-e.

## Contexto

- **MEDIUM-3(a):** a policy `outbox_tenant_insert` (0086) só prende a coluna `workspace_id`. O `envelope.workspaceId`, que é o que os consumidores usam, não é conferido, e com `exchange=''` o `routing_key` pode ser qualquer fila.
- **MEDIUM-3(b):** em produção api, workers e agent-runtime conectam como `PG_USER` (superuser). Fica como backlog documentado: papéis de login separados.
- **L-d:** `dead` fica 30 dias com o envelope inteiro; `OUTBOX_*` não está no compose.
- **L-e:** `uq_outbox_event_id` é global.

## Escopo

### files_allowed

- `packages/db/drizzle/**`
- `packages/db/src/schema/outbox.ts`
- `packages/db/src/outbox*.ts`
- `packages/shared/src/mq/outbox.ts`
- `apps/workers/src/outbox/**`
- `infra/docker/docker-compose.prod.yml`
- `.env.production.example`
- `docs/runbooks/**`

## Escopo (faz)

- Migração: `CHECK ((envelope->>'workspaceId')::uuid = workspace_id)` para eventos e jobs que carregam workspace, e `CHECK` de `routing_key` contra a lista de filas aceitas quando `exchange = ''`. Pré-voo que aborta se já houver linha violando.
- O relay repete as duas checagens antes de publicar; a linha que viola vai para `dead`, com log.
- Unicidade por `(workspace_id, event_id)`.
- `OUTBOX_*` no bloco `x-app-env` do compose, e `OUTBOX_DEAD_RETENTION_DAYS` alinhado à retenção de dado pessoal (documentar a escolha).
- A lista de filas aceitas vem de `OUTBOX_JOB_QUEUES` (a F70-S25 acrescentou `hm.q.flows`, `hm.q.flow.execution` e `hm.q.campaigns`); o CHECK do banco e a checagem do relay derivam da mesma fonte, com teste que falha se divergirem.
- `FLOW_RUNNING_STALE_MS` e `FLOW_RUNNING_MAX_AGE_MS` (F70-S25) também entram no compose e no `.env.production.example`.
- Runbook: consulta de pré-deploy das execuções `running` paradas (a recuperação da S25 retoma as de até 24 h e marca `failed` as mais velhas no primeiro tick).
- Runbook: backlog dos papéis de login separados (MEDIUM-3b), com o plano.

## Definition of Done

- [ ] teste: INSERT com `envelope.workspaceId` diferente da coluna → recusado pelo banco
- [ ] teste: fila fora da lista → recusado pelo banco e pelo relay
- [ ] teste: mesmo `event_id` em dois workspaces → aceito
