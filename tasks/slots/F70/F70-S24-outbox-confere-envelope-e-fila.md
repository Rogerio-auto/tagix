---
id: F70-S24
title: Outbox confere envelope e fila contra o workspace, retenção configurável e event_id por workspace
phase: F70
status: done
priority: medium
estimated_size: S
depends_on: [F70-S25]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S16-outbox-transacional.md
agent_id: backend-engineer
claimed_at: 2026-09-25T14:11:57Z
completed_at: 2026-09-25T14:43:47Z

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

- [x] teste: INSERT com `envelope.workspaceId` diferente da coluna → recusado pelo banco
- [x] teste: fila fora da lista → recusado pelo banco e pelo relay
- [x] teste: mesmo `event_id` em dois workspaces → aceito

## Decisões

### Migração 0091 (`0091_f70_outbox_route_guard.sql`, `when` 1781452852000)

CHECKs novos. Valem para todo papel, inclusive superuser, ao contrário da RLS:

| CHECK | Regra |
| --- | --- |
| `outbox_envelope_workspace_chk` | `lower(envelope->>'workspaceId') IS NOT DISTINCT FROM workspace_id::text` |
| `outbox_kind_exchange_chk` | `(kind = 'job') = (exchange = '')` |
| `outbox_job_queue_chk` | `exchange <> '' OR routing_key IN (<OUTBOX_JOB_QUEUES>)` |
| `outbox_event_routing_chk` | `exchange <> 'hm.events' OR starts_with(routing_key, 'domain.')` |

- **Texto, não cast.** A spec sugeria `(envelope->>'workspaceId')::uuid = workspace_id`. Um
  `workspaceId` que não fosse uuid daria `22P02` no meio da transação do produtor, e envelope
  sem a chave daria NULL, que passa num CHECK. A comparação do texto em minúsculas com o uuid
  canônico dá `23514` nos dois casos. Aceita o mesmo uuid em maiúsculas (o zod aceita).
- **`hm.events` também precisava de trava.** O `assertTopology` liga cada fila de trabalho em
  `hm.events` com `hm.q.<fila>.#`. Travar só o exchange `''` deixava um `event` com routing key
  `hm.q.inbound.x` chegar ao inbound. Por isso entram `outbox_event_routing_chk` (só `domain.*`,
  que só casa com o bind `domain.#` da fila de webhooks) e `outbox_kind_exchange_chk`.
- **Pré-voo** no estilo da 0085/0086: `LOCK ... SHARE ROW EXCLUSIVE` antes, para o resultado
  não envelhecer até o `ALTER`, e `RAISE EXCEPTION` com contagem por regra
  (`envelope_workspace/kind_exchange/job_queue/event_routing`). Exige superuser, BYPASSRLS ou
  `hm_outbox_relay`, porque a tabela tem FORCE RLS. Nunca apaga linha.
- **Os quatro CHECKs num `ALTER` só**, validados numa passada. `lock_timeout` 10s.

### Fonte única das filas

- A lista vive em `OUTBOX_JOB_QUEUES` (`packages/shared/src/mq/outbox.ts`):
  - o relay lê a constante (`outboxRowViolation`);
  - o schema Drizzle monta o CHECK dela;
  - a migração é SQL estático e repete a lista.
- `apps/workers/src/outbox/constraints.test.ts` extrai as filas de
  `pg_get_constraintdef('outbox_job_queue_chk')` e compara com a constante. Fila nova sem
  migração deixa o teste vermelho. O CHECK também tem `COMMENT` apontando a constante.

### `event_id` por workspace e privilégio do `hm_app`

- `uq_outbox_event_id (event_id)` foi trocado por `uq_outbox_workspace_event (workspace_id, event_id)`.
  O `idx_outbox_workspace` saiu, porque o índice novo cobre a FK de workspaces pelo prefixo.
- **Todos os `ON CONFLICT` que dependiam do índice antigo:** só o `enqueueOutbox`
  (`packages/db/src/outbox.ts`). Nenhum SQL cru no repo usava `ON CONFLICT (event_id)` na outbox.
- **`enqueueOutbox` usa `ON CONFLICT DO NOTHING` sem alvo.**
  - Com alvo, o Postgres exige SELECT nas colunas árbitro. Com RLS, também aplica a policy de
    SELECT à linha nova. Conferi no PG 16 do dev: com alvo `(ws, ev)` e só a policy de INSERT,
    dá erro de RLS; sem alvo, passa com INSERT puro.
  - Por isso o "SELECT(event_id) mínimo" passou a nenhum SELECT: a 0091 revoga
    `SELECT (event_id)` do `hm_app` e remove a policy `outbox_tenant_select`. O `hm_app` só
    **grava** na outbox.
  - As duas formas são equivalentes porque os únicos índices únicos da tabela são a PK (identity
    `GENERATED ALWAYS`, que nunca colide) e `uq_outbox_workspace_event`. O teste trava esse
    conjunto: um índice único novo faria o DO NOTHING engolir outra colisão.
- O dedup do consumidor de webhooks (`(webhook_id, _meta.eventId)`) já é por webhook, e o webhook
  é de um workspace. Não muda nada.

### Relay

- Depois do `envelopeSchema`, o relay roda `outboxRowViolation` (as mesmas regras dos CHECKs).
  A linha que viola vai **direto para `dead`**:
  - não chega ao publisher e não gasta tentativa de broker;
  - `last_error` recebe o motivo (`queue_not_allowed: <fila>`, `workspace_mismatch`,
    `event_routing_key_not_allowed`, `job_exchange_not_allowed`, `event_exchange_not_allowed`,
    `kind_not_allowed`);
  - o log `error` diz `recusada antes de publicar`, com outboxId, eventId, kind, workspace,
    exchange e routing key. O payload nunca vai para o log.
- Envelope inválido usa o mesmo log (antes dizia "esgotou as tentativas", o que era falso).
- Essa linha só existe se alguém tirou um CHECK à mão. Com o CHECK presente, mesmo `NOT VALID`,
  o `UPDATE ... status = 'dead'` falharia e o lote voltaria inteiro. Por isso o teste tira as
  constraints e as recria validadas no `finally`.

### Retenção: `OUTBOX_DEAD_RETENTION_DAYS` = 7 (era 30)

- A linha morta guarda o envelope inteiro: texto de mensagem, telefone, nome. A exclusão de
  contato não alcança a outbox.
- Sete dias cobrem uma semana inteira de triagem, com fim de semana. O relay loga `error` a cada
  10 min enquanto houver morto, então ninguém deixa de ver.
- Guardar por mais tempo só prolonga a cópia do dado pessoal (LGPD, minimização). É a mesma
  janela dos enviados: a outbox inteira fica com, no máximo, 7 dias de dado.
- `DEFAULT_OUTBOX_SENT_RETENTION_DAYS` e `DEFAULT_OUTBOX_DEAD_RETENTION_DAYS` são exportados de `@hm/db`.

### Compose e ambiente

- No `x-app-env`:
  - `OUTBOX_BATCH_SIZE`, `OUTBOX_POLL_MS`, `OUTBOX_MAX_ATTEMPTS`, vazios (o default fica no código);
  - `OUTBOX_SENT_RETENTION_DAYS` e `OUTBOX_DEAD_RETENTION_DAYS`, com `:-7` explícito;
  - `FLOW_RUNNING_STALE_MS` e `FLOW_RUNNING_MAX_AGE_MS`, vazios.
- Os parsers tratam vazio como default.
- O bloco `postgres:` não mudou. O recorte do `deploy.sh` foi provado com
  `pytest scripts/tests` (11 passam; 1 skip é o shellcheck fora do PATH).
- O mesmo conjunto, comentado, está no `.env.production.example`.

### Runbooks

- `docs/runbooks/outbox-operations.md`:
  - regras e motivos;
  - pré-deploy da 0091: a 0086 já está em produção? Pré-voo manual, inspeção sem payload e locks;
  - pré-deploy das execuções `running` paradas (S25), com a consulta por grupo (ativa /
    reanimada / vira failed) e o detalhe do grupo que vai mandar mensagem;
  - triagem dos mortos.
- `docs/runbooks/database-login-roles.md`: backlog MEDIUM-3b. Situação, papéis-alvo por serviço
  (`hm_api_login`, `hm_workers_login` com `hm_outbox_relay`, `hm_runtime_login`), plano
  expand/contract em 5 etapas, rollback e verificação.
- `deploy-production.md`:
  - a 0091 entra como exceção registrada da regra §3.1;
  - aponta os dois runbooks.

### Como reverter a 0091

```sql
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE outbox
  DROP CONSTRAINT IF EXISTS outbox_envelope_workspace_chk,
  DROP CONSTRAINT IF EXISTS outbox_kind_exchange_chk,
  DROP CONSTRAINT IF EXISTS outbox_job_queue_chk,
  DROP CONSTRAINT IF EXISTS outbox_event_routing_chk;
-- O índice global só volta se nenhum event_id se repetir entre workspaces:
--   SELECT event_id, count(*) FROM outbox GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX uq_outbox_event_id ON outbox (event_id);
CREATE INDEX idx_outbox_workspace ON outbox (workspace_id);
DROP INDEX uq_outbox_workspace_event;
GRANT SELECT (event_id) ON outbox TO hm_app;
CREATE POLICY outbox_tenant_select ON outbox
  FOR SELECT TO hm_app USING (workspace_id = app_current_workspace());
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1781452852000;
COMMIT;
```

- O `enqueueOutbox` novo (sem alvo) funciona com o schema antigo. Reverter o código não é
  obrigatório para reverter o banco.
- Se houver linhas em inspeção no pré-voo, o critério está no runbook §3.2:
  - `sent`: pode apagar;
  - `pending`/`dead`: nunca republicar. É incidente.

## Riscos

- **Janela do deploy, se a 0086 já estiver em produção.** A 0091 não é aditiva para o código
  anterior. O `ON CONFLICT (event_id)` antigo fica sem índice árbitro e sem SELECT. Entre o fim
  da migração e a convergência do `stack deploy`, todo `enqueueOutbox` do código velho falha e
  derruba a transação de negócio dele:
  - a API responde 500;
  - o job de worker volta pela ladder de retry.

  Pelo histórico (a S22 descreve a outbox como ainda inexistente em produção), a 0086 e a 0091
  devem subir juntas, e aí não há janela. O runbook §3.1 manda conferir com `to_regclass` antes.
  Expand/contract de verdade exigiria duas migrações em dois deploys. Não fiz, porque a 0092
  está reservada e o DoD pede a unicidade por workspace nesta slot.
- **Lock da migração.** A `outbox` fica travada:
  - `SHARE ROW EXCLUSIVE` no pré-voo;
  - `ACCESS EXCLUSIVE` no `ALTER` e no build do índice.

  Isso dura o tempo de ler a tabela duas ou três vezes. A tabela é limitada pela retenção.
  Produtores (toda transação que grava evento ou job) e relay esperam até o COMMIT. Com
  `lock_timeout` 10s, a migração falha rápido se não conseguir o lock, e o `deploy.sh` tenta 6 vezes.
- **Linhas em voo no deploy:**
  - as `pending` gravadas pelo código velho seguem as regras (os construtores sempre
    produziram envelope do workspace da coluna e filas da lista). O pré-voo confirma; no dev
    compartilhado deu zero em todas as regras;
  - as `sent`/`dead` antigas com mais de 7 dias somem na primeira limpeza depois do deploy.
    Isso é esperado.
- **Primeiro tick da S25:** execuções `running` de 5 min a 24 h são reanimadas e mandam
  mensagem. A consulta de pré-deploy e a alavanca (`FLOW_RUNNING_MAX_AGE_MS` menor só no primeiro
  deploy) estão no runbook §4.

## Pendências fora da fronteira

- O slot F70-S16 (Decisões, tabela de acesso) ainda descreve `hm_app` com `SELECT (event_id)` e a
  policy `outbox_tenant_select`. A 0091 e o runbook são a referência atual.
- MEDIUM-3(b), papéis de login separados: plano em `docs/runbooks/database-login-roles.md`,
  para uma slot própria.
- Se um lote do relay falhar ao marcar (UPDATE recusado), o lote volta inteiro e trava a cabeça
  da fila. Hoje só aconteceria com um CHECK `NOT VALID` e uma linha violando, o que não ocorre no
  fluxo normal. Endurecer (marcar linha a linha no fallback) seria outra slot.
- A 0091 não foi aplicada no banco dev compartilhado (`highermind`). O código da F70-S26, que
  roda em paralelo sobre a `main`, ainda usa `ON CONFLICT (event_id)` e quebraria. A validação
  rodou num banco isolado, `highermind_f70s24` (todas as migrações 0001–0091 do zero). O
  orquestrador aplica no merge. O pré-voo lido no `highermind` deu zero violações.

## Validação

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/workers typecheck
python -m pytest -q scripts/tests
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq/outbox.test.ts src/mq/agent-run.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/outbox --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound/media-outbox.test.ts src/inbound/agent-run-outbox.test.ts src/campaigns/conversation-opened.test.ts src/flows/outbound-publisher.outbox.test.ts src/campaigns-inbound/outbox.test.ts --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/v1/outbox.integration.test.ts src/routes/conversations/messages.outbox.integration.test.ts src/routes/deals/outbox.integration.test.ts --maxWorkers=1
node --env-file=.env packages/flow-engine/node_modules/vitest/vitest.mjs run --root packages/flow-engine src/ports/db.port.outbox.test.ts --maxWorkers=1
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/rls.test.ts src/rls-empty-guc.test.ts --maxWorkers=1
```

Números (banco isolado `highermind_f70s24` com 0001–0091, RabbitMQ dev):

- `apps/workers/src/outbox`: 22/22.
  - `constraints.test.ts` 12: fonte única via `pg_get_constraintdef`, conjunto de índices
    únicos, privilégios do `hm_app`, DoD 1 (hm_app e dono; sem chave, lixo, maiúsculas), DoD 2
    no banco (fila, `hm.events` → fila, kind/exchange; as 5 filas aceitas) e no relay (3 linhas
    → `dead` com motivo, nada publicado, log sem payload), DoD 3 (mesmo `event_id` em A e B;
    repetido em A → 0 sem abortar), pré-voo aborta com `2 violação(ões)` e o DETAIL por regra,
    retenção e env.
  - `relay.test.ts` 10: jobs gravados em `hm.q.media` e desviados no publisher do teste para
    a fila privada. `hm_app` agora não lê nem o `event_id`.
- Produtores da outbox nos workers: 21/21 (5 arquivos). API: 26/26 (3 arquivos). flow-engine: 8/8.
  `@hm/db` RLS: 60/60. `@hm/shared` mq: 13/13.
- Typecheck `@hm/shared`, `@hm/db` e `@hm/workers` limpos. ESLint limpo nos arquivos tocados.
  `check-migrations` OK. `pytest scripts/tests`: 11 passam, 1 skip (shellcheck).
