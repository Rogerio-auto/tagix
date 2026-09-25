# Runbook — Outbox transacional e checagens de pré-deploy (F70-S16/S24/S25)

> Quem usa: quem faz o deploy e quem atende o alerta `outbox: mensagens mortas aguardando ação`.
> Onde roda: servidor de produção (bash). Nada aqui altera dado sem uma decisão explícita.

```bash
PG=$(docker ps -qf name=leadium_postgres | head -1)
psqlc() { docker exec -i "$PG" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"; }
```

## 1. O que a outbox guarda e por quanto tempo

- Uma linha por evento de domínio (`hm.events`, routing key `domain.*`) ou job de fila
  (exchange padrão, fila de `OUTBOX_JOB_QUEUES`), gravada na transação do dado.
- O envelope inteiro fica na linha: **dado pessoal** (texto de mensagem, telefone, nome).
  A exclusão de contato não alcança a outbox.
- Retenção (`OUTBOX_SENT_RETENTION_DAYS`, `OUTBOX_DEAD_RETENTION_DAYS`): **7 dias** para
  `sent` e para `dead`. Os mortos eram 30 dias até a F70-S24: sete dias cobrem uma semana
  de triagem, com o alerta `error` a cada 10 min, sem guardar a cópia do dado além disso.
  Aumentar exige motivo registrado (LGPD, minimização).

## 2. O que o banco e o relay recusam (0091)

| Regra | CHECK | Motivo no `last_error` do relay |
| --- | --- | --- |
| `envelope.workspaceId` = coluna `workspace_id` | `outbox_envelope_workspace_chk` | `workspace_mismatch` |
| `job` só pelo exchange `''`, `event` só por `hm.events` | `outbox_kind_exchange_chk` | `job_exchange_not_allowed` / `event_exchange_not_allowed` |
| job só nas filas de `OUTBOX_JOB_QUEUES` | `outbox_job_queue_chk` | `queue_not_allowed` |
| evento só com routing key `domain.*` | `outbox_event_routing_chk` | `event_routing_key_not_allowed` |
| envelope no contrato | — | `invalid_envelope` |

- O produtor que viola recebe `23514` e a transação dele cai: é defeito de código.
- O relay repete as regras antes de publicar. A linha que viola vai direto para `dead`,
  sem publicar, com log `error` `recusada antes de publicar` (workspace, destino, motivo;
  nunca o payload). Ela só existe se alguém tirou um CHECK à mão.
- **Fila nova pela outbox:** acrescente em `OUTBOX_JOB_QUEUES`
  (`packages/shared/src/mq/outbox.ts`) e recrie `outbox_job_queue_chk` numa migração. O
  teste `apps/workers/src/outbox/constraints.test.ts` falha enquanto os dois divergirem.

## 3. Pré-deploy da 0091

### 3.1. A 0086 já está em produção?

```bash
psqlc -tAc "SELECT to_regclass('public.outbox') IS NOT NULL"
```

- `f`: a 0086 e a 0091 sobem juntas. O código anterior não conhece a outbox: nada a fazer.
- `t`: **a 0091 não é aditiva para o código anterior.** Ela troca `uq_outbox_event_id` por
  `(workspace_id, event_id)` e tira o `SELECT(event_id)` do `hm_app`. Entre o fim da
  migração (passo 6 do `deploy.sh`) e a troca dos containers (passo 7), o `enqueueOutbox`
  antigo (`ON CONFLICT (event_id)`) falha com `42P10`/permissão, e a transação de negócio
  dele cai: request da API com 500, job de worker volta pela fila de retry. A janela é o
  tempo de convergência do `stack deploy` (dezenas de segundos). Faça o deploy em horário
  de pouco tráfego e acompanhe `docker service logs -f leadium_api` até a convergência.

### 3.2. Pré-voo manual (o mesmo da migração)

A migração aborta, sem alterar nada, se alguma linha violar. Para ver antes:

```bash
psqlc <<'SQL'
SELECT 'envelope_workspace' AS regra, count(*) FROM outbox
 WHERE lower(envelope ->> 'workspaceId') IS DISTINCT FROM workspace_id::text
UNION ALL
SELECT 'kind_exchange', count(*) FROM outbox WHERE (kind = 'job') <> (exchange = '')
UNION ALL
SELECT 'job_queue', count(*) FROM outbox
 WHERE exchange = '' AND routing_key NOT IN
   ('hm.q.outbound', 'hm.q.media', 'hm.q.flows', 'hm.q.flow.execution', 'hm.q.campaigns')
UNION ALL
SELECT 'event_routing', count(*) FROM outbox
 WHERE exchange = 'hm.events' AND NOT starts_with(routing_key, 'domain.');
SQL
```

Tudo zero: siga. Qualquer linha: inspecione (sem imprimir o payload) e decida.

```bash
psqlc -c "SELECT id, workspace_id, kind, exchange, routing_key, status, created_at,
                 envelope ->> 'workspaceId' AS env_ws, envelope ->> 'type' AS type
            FROM outbox
           WHERE lower(envelope ->> 'workspaceId') IS DISTINCT FROM workspace_id::text
              OR (kind = 'job') <> (exchange = '')
              OR (exchange = '' AND routing_key NOT IN ('hm.q.outbound', 'hm.q.media', 'hm.q.flows', 'hm.q.flow.execution', 'hm.q.campaigns'))
              OR (exchange = 'hm.events' AND NOT starts_with(routing_key, 'domain.'))
           ORDER BY id LIMIT 100"
```

- `sent`: já saiu; apagar a linha não muda nada. `DELETE FROM outbox WHERE id IN (...)`.
- `pending`/`dead`: **é o sintoma que a 0091 fecha.** Não republique. Registre o incidente
  (workspace, tipo, destino), apague as linhas e investigue o produtor.

### 3.3. Locks

A 0091 trava a `outbox` (SHARE ROW EXCLUSIVE no pré-voo, ACCESS EXCLUSIVE no `ALTER` e no
índice) pelo tempo de ler a tabela duas ou três vezes. A tabela é limitada pela retenção.
Produtores e relay esperam até o COMMIT; `lock_timeout = 10s` faz a migração falhar rápido
(o `deploy.sh` tenta de novo) em vez de enfileirar tráfego atrás dela. Para medir antes:

```bash
psqlc -c "SELECT status, count(*), pg_size_pretty(pg_total_relation_size('outbox')) FROM outbox GROUP BY status"
```

## 4. Pré-deploy da F70-S25: execuções de flow `running` paradas

A recuperação da S25 roda no primeiro tick do scheduler depois do deploy:

- parada há mais de `FLOW_RUNNING_STALE_MS` (5 min) e menos de `FLOW_RUNNING_MAX_AGE_MS`
  (24 h): **é reanimada e roda** (pode mandar mensagem ao contato);
- mais velha que 24 h: vira `failed`, sem enviar nada.

Antes do deploy, veja o volume de cada grupo:

```bash
psqlc <<'SQL'
SELECT CASE
         WHEN coalesce(updated_at, started_at) > now() - interval '5 minutes' THEN '1 ativa (< 5 min)'
         WHEN coalesce(updated_at, started_at) > now() - interval '24 hours'  THEN '2 reanimada no 1º tick'
         ELSE '3 vira failed no 1º tick'
       END AS destino,
       count(*) AS execucoes,
       count(DISTINCT workspace_id) AS workspaces,
       min(coalesce(updated_at, started_at)) AS mais_antiga
  FROM flow_executions
 WHERE status = 'running'
 GROUP BY 1
 ORDER BY 1;
SQL
```

Detalhe do grupo que vai rodar (quem recebe mensagem):

```bash
psqlc -c "SELECT workspace_id, flow_id, count(*) AS execucoes,
                 min(coalesce(updated_at, started_at)) AS desde
            FROM flow_executions
           WHERE status = 'running'
             AND coalesce(updated_at, started_at) <= now() - interval '5 minutes'
             AND coalesce(updated_at, started_at) >  now() - interval '24 hours'
           GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50"
```

- Poucas execuções, flows de atendimento: siga.
- Muitas, ou flows cuja mensagem atrasada faria mal (lembrete, oferta com prazo): no
  primeiro deploy, defina `FLOW_RUNNING_MAX_AGE_MS` menor no `.env` do servidor (ex.:
  `3600000`, 1 h). As mais velhas que isso viram `failed`. Depois do primeiro tick, volte
  ao default (apague a variável) e rode o deploy de novo, ou `docker service update
  --env-rm FLOW_RUNNING_MAX_AGE_MS leadium_workers`.
- Depois do deploy, confira: `status = 'failed' AND last_error` com o erro de expiração, e
  o log `error` do scheduler.

## 5. Alerta: mensagens mortas

```bash
psqlc -c "SELECT id, workspace_id, kind, routing_key, attempts, last_error, created_at
            FROM outbox WHERE status = 'dead' ORDER BY id LIMIT 50"
```

- `unroutable`/`nack`/`no_confirm` depois de 12 tentativas: o broker recusou por muito
  tempo (fila apagada, política). Corrija a causa e republique:
  `UPDATE outbox SET status = 'pending', attempts = 0, available_at = now() WHERE id IN (...)`.
  O consumidor deduplica (entrega pelo menos uma vez).
- Motivo da seção 2 (`queue_not_allowed`, `workspace_mismatch`…): **nunca republique.**
  Trate como incidente de segurança: alguém tirou um CHECK ou gravou por fora do produtor.
- Sem ação, a linha morta some em `OUTBOX_DEAD_RETENTION_DAYS` dias.
