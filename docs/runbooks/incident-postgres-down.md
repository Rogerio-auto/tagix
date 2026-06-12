# Runbook — Postgres indisponível (produção)

> **Para quem:** SRE / on-call do `tagix` (Highermind v2) respondendo a um incidente de banco em produção, às 3h da manhã, sob pressão.
> **Ambiente:** VPS Ubuntu 24.04, Docker Compose (`infra/docker/docker-compose.prod.yml`). Container `postgres` = `pgvector/pgvector:pg16`, volume `postgres-data`, DB `highermind`.
> **Severidade:** **SEV1**. Postgres é a fonte de verdade. Com ele fora, `api`, `workers`, `scheduler` e `agent-runtime` degradam ou caem. Inbound de canais para de persistir.
> **Comandos são bash (Linux/prod). Nunca PowerShell — prod é o único contexto bash do projeto.**

> ⚠️ **Antes de qualquer ação que toque dados/volume:** este runbook **não** apaga o volume `postgres-data` em nenhum passo. Restore destrutivo é assunto de [`restore-from-backup.md`](./restore-from-backup.md) e só ocorre lá, com backup explícito.

---

## 0. Convenções

```bash
# Defina uma vez no início da sessão de incidente:
cd /root/highermind
export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
# PG_USER / PG_PASSWORD / POSTGRES_DB vêm do .env do compose (DB = highermind).
# Quase todo psql roda DENTRO do container, então não precisa expor a porta.
psqlc() { $COMPOSE exec -T postgres psql -U "$PG_USER" -d highermind "$@"; }
```

Carregue as vars do ambiente do compose se não estiverem no shell:

```bash
set -a; source /root/highermind/.env; set +a
```

---

## 1. Sintomas / Detecção

Você chega aqui por um destes sinais:

- Alerta de health: `curl http://localhost:3001/health` falha ou retorna `db: down`.
- Logs da `api` cuspindo `ECONNREFUSED`, `Connection terminated`, `timeout expired`, ou `too many clients already`.
- Painel `/admin/infrastructure` sem dados de Postgres, ou workers com backlog crescente em RabbitMQ (`mq.<domínio>`).
- Frontend retornando 5xx em rotas que leem dados.

Confirme o estado real antes de agir:

```bash
# 1. O container está de pé?
$COMPOSE ps postgres

# 2. Healthcheck do compose (pg_isready):
$COMPOSE exec -T postgres pg_isready -U "$PG_USER" -d highermind

# 3. Postgres aceita conexão e responde query trivial?
psqlc -c 'select 1;'
```

Interprete:

| Resultado | Diagnóstico provável | Vá para |
|---|---|---|
| `ps` mostra container **ausente/exited** | Crash ou OOM kill | §2 |
| `ps` mostra `restarting` em loop | Falha no boot (config / corrupção / disco) | §3 |
| `pg_isready` = `no response` mas container `up` | Postgres travado / startup recovery longo | §3 |
| `pg_isready` OK mas `select 1` falha com `too many clients` | Esgotamento de conexões (não é "down" de verdade) | §4 |
| `select 1` OK | Postgres está vivo — o problema é em outra camada (rede/app) | §6 |

---

## 2. Container ausente ou parado (crash / OOM)

1. Veja por que morreu:

   ```bash
   $COMPOSE ps -a postgres
   docker inspect highermind-postgres-1 --format '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
   $COMPOSE logs --tail=200 postgres
   ```

2. Se `oom=true`: o host ficou sem RAM. Cheque memória e o que a consumiu:

   ```bash
   free -h
   dmesg -T | grep -i -E 'killed process|out of memory' | tail -20
   docker stats --no-stream
   ```

   Se outro processo estourou a RAM, contenha-o antes de subir o Postgres (senão ele morre de novo). Não há ação destrutiva aqui — apenas restart.

3. Suba só o Postgres e acompanhe o boot:

   ```bash
   $COMPOSE up -d postgres
   $COMPOSE logs -f postgres   # Ctrl-C quando aparecer "database system is ready to accept connections"
   ```

4. Vá para §5 (verificação de recuperação).

---

## 3. Container em loop de restart ou travado no boot

1. Leia o log — a causa quase sempre está nas últimas linhas:

   ```bash
   $COMPOSE logs --tail=300 postgres
   ```

   Padrões comuns:

   - `PANIC: could not locate a valid checkpoint record` → **corrupção do WAL**. Pare aqui e vá para [`restore-from-backup.md`](./restore-from-backup.md). **Não** rode `pg_resetwal` às cegas — ele descarta WAL e pode causar perda silenciosa.
   - `FATAL: the database system is starting up` repetido → crash recovery em andamento. Pode ser legítimo após kill abrupto. Aguarde e monitore (passo 2).
   - `could not write to file ... No space left on device` → **disco cheio**. Vá para §3.1.
   - `FATAL: data directory ... has invalid permissions` → permissão do volume. Não tente `chmod` no host sem entender a causa; abra o caso e prefira restore.

2. Se for crash recovery legítimo, dê tempo e observe progresso (não mate o processo no meio do recovery):

   ```bash
   $COMPOSE logs -f postgres
   # Espere "database system is ready to accept connections".
   ```

### 3.1 Disco cheio

1. Confirme:

   ```bash
   df -h /
   du -sh /var/lib/docker/volumes/highermind_postgres-data 2>/dev/null
   ```

2. Ganhe espaço **sem tocar nos dados do Postgres**. Limpe o que é descartável:

   ```bash
   docker image prune -af        # imagens não usadas
   docker builder prune -af      # cache de build
   journalctl --vacuum-size=200M # logs do systemd
   # NÃO rode `docker volume prune` — ele pode remover volumes de dados.
   ```

3. Se ainda apertado, mova/comprima logs Docker grandes:

   ```bash
   du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail
   # Truncar um log de container específico (NÃO o volume de dados):
   truncate -s 0 /var/lib/docker/containers/<id>/<id>-json.log
   ```

4. Com espaço liberado, suba o Postgres (§2 passo 3) e vá para §5.

---

## 4. Esgotamento de conexões (`too many clients already`)

Postgres está vivo, mas todas as `max_connections = 200` estão tomadas. Geralmente é um app vazando conexões ou uma query travada segurando o pool.

1. Veja quem está conectado (psql como superuser dentro do container — não consome o pool da app):

   ```bash
   psqlc -c "
     select state, count(*)
     from pg_stat_activity
     where datname = 'highermind'
     group by state order by count(*) desc;"
   ```

2. Encontre transações idle-in-transaction antigas (a causa #1 de pool esgotado):

   ```bash
   psqlc -c "
     select pid, usename, state, now()-state_change as idle_for,
            left(query,80) as query
     from pg_stat_activity
     where datname='highermind' and state='idle in transaction'
     order by state_change asc limit 20;"
   ```

3. **Encerre apenas** as conexões idle-in-transaction há mais de 5 min (não destrutivo — só cancela a sessão; nenhuma transação committada é perdida):

   ```bash
   psqlc -c "
     select pg_terminate_backend(pid)
     from pg_stat_activity
     where datname='highermind'
       and state='idle in transaction'
       and now()-state_change > interval '5 minutes';"
   ```

4. Se a causa for um worker/api vazando, reinicie o serviço culpado (não o Postgres) para devolver o pool:

   ```bash
   $COMPOSE restart api          # ou worker-inbound, worker-outbound, etc.
   ```

5. Vá para §5.

---

## 5. Verificação de recuperação ("resolvido")

Considere o incidente resolvido **somente** quando TODOS passarem:

1. Postgres aceita conexões:

   ```bash
   $COMPOSE exec -T postgres pg_isready -U "$PG_USER" -d highermind   # → "accepting connections"
   psqlc -c 'select now(), version();'
   ```

2. **RLS continua ativo** (multi-tenant é fundação — se RLS caiu, o incidente NÃO está resolvido):

   ```bash
   # Tabelas core devem ter rowsecurity = true:
   psqlc -c "
     select relname, relrowsecurity
     from pg_class
     where relname in ('conversations','messages','contacts','channels','channel_secrets')
     order by relname;"
   # Toda linha deve mostrar relrowsecurity = t.

   # Prova funcional: sem app.workspace_id setado, uma leitura tenant-scoped deve voltar 0 linhas.
   psqlc -c "reset role; select count(*) from conversations;"   # esperado: 0 (RLS bloqueia sem workspace_id)
   ```

   Se `relrowsecurity = f` em qualquer tabela tenant, há regressão grave de isolamento → escale e **não** libere tráfego de clientes até corrigir.

3. Conexões saudáveis (longe do teto de 200):

   ```bash
   psqlc -c "select count(*) as conns from pg_stat_activity where datname='highermind';"
   ```

4. App enxerga o banco:

   ```bash
   curl -fsS http://localhost:3001/health   # deve retornar healthy / db: up
   ```

5. Workers drenando backlog (sem acúmulo permanente): cheque `mq.<domínio>` (RabbitMQ Management) ou:

   ```bash
   $COMPOSE logs --tail=50 worker-inbound | grep -i -E 'ack|processed|ready'
   ```

---

## 6. Se o Postgres está OK mas a app não conecta

O banco respondeu `select 1` mas a `api` reclama. O problema é rede/config, não o Postgres.

1. Teste a resolução DNS interna e a porta a partir do container `api`:

   ```bash
   $COMPOSE exec -T api sh -lc 'getent hosts postgres; nc -zv postgres 5432'
   ```

2. Confira se `.env.api` aponta `DATABASE_URL` para o host `postgres` (DNS interno do Docker), porta `5432`, db `highermind`. **Nunca** logue a senha; apenas o host/db:

   ```bash
   $COMPOSE exec -T api sh -lc 'echo "$DATABASE_URL" | sed -E "s#://[^@]+@#://<redacted>@#"'
   ```

3. Se a rede Docker corrompeu, recrie só a stack de app (Postgres permanece de pé):

   ```bash
   $COMPOSE up -d --no-deps --force-recreate api worker-inbound worker-outbound
   ```

4. Volte para §5.

---

## 7. Pós-incidente

- Registre timeline, causa-raiz e MTTR.
- Se foi OOM/disco, abra follow-up para alerta proativo (`free -h`, `df -h`) no Grafana (§14 do `INFRASTRUCTURE.md`).
- Se foi corrupção → o restore já aconteceu em [`restore-from-backup.md`](./restore-from-backup.md); valide que o backup diário (cron 03:00 BRT) voltou a rodar.
