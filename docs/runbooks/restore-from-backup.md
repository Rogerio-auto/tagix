# Runbook — Restore do Postgres a partir de backup (produção)

> **Para quem:** SRE / on-call do `tagix` (Highermind v2) restaurando o banco de produção após corrupção, perda de dados ou desastre da VPS.
> **Ambiente:** VPS Ubuntu, Docker Compose. Container `postgres` = `pgvector/pgvector:pg16`, DB `highermind`.
> **Origem do backup:** cron diário 03:00 BRT (vide `INFRASTRUCTURE.md` §5.5):
> `pg_dump --format=custom --compress=9 highermind` → cifrado `openssl aes-256-cbc -salt -k $BACKUP_KEY` → upload R2 `highermind-backups/{ano}/{mês}/{dia}/dump-{timestamp}.enc`. Retenção 30 dias.
> **RPO esperado:** até 24h (último dump diário). **RTO alvo:** 1h.
> **Comandos são bash (Linux/prod). Nunca PowerShell.**

> 🔴 **AVISO — operação destrutiva.** Restaurar **sobrescreve o estado atual do banco**. Antes de qualquer `pg_restore --clean` ou recriação de DB, este runbook obriga um **dump de segurança do estado corrente** (§3). Nunca pule o §3.

---

## 0. Pré-requisitos e convenções

```bash
cd /root/highermind
export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
set -a; source /root/highermind/.env; set +a   # PG_USER, PG_PASSWORD, BACKUP_KEY, R2_* etc.
psqlc() { $COMPOSE exec -T postgres psql -U "$PG_USER" -d highermind "$@"; }
WORK=/root/restore-$(date +%Y%m%d-%H%M%S); mkdir -p "$WORK"; cd "$WORK"
echo "Workdir: $WORK"
```

Você precisa de: `BACKUP_KEY` (chave do `openssl` dos backups) e credenciais R2 (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, bucket `highermind-backups`). `aws` CLI configurado para o endpoint R2, ou use `rclone`.

---

## 1. Sintomas / Quando restaurar

Use este runbook quando:

- Postgres não recupera por restart (corrupção de WAL/checkpoint — encaminhado por [`incident-postgres-down.md`](./incident-postgres-down.md) §3).
- Perda/corrupção lógica de dados (DELETE/UPDATE em massa acidental, migration destrutiva mal aplicada).
- Provisionamento de VPS nova em DR (cenário "VPS down" do `INFRASTRUCTURE.md` §13.1).

**Decisão rápida:** se o dado perdido é recente (< minutos) e o banco está íntegro, prefira correção pontual a restore total. Restore é a opção quando a integridade do cluster está comprometida.

---

## 2. Selecionar e baixar o backup correto

1. Liste os backups disponíveis (mais recentes primeiro):

   ```bash
   # Via AWS CLI apontado pro R2:
   aws s3 ls "s3://highermind-backups/$(date +%Y/%m)/" \
     --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
     | sort | tail -20
   ```

2. Escolha o dump (em DR por corrupção, geralmente o **último íntegro** anterior ao incidente). Baixe:

   ```bash
   BACKUP_OBJECT="$(date +%Y/%m/%d)/dump-<timestamp>.enc"   # ajuste para o escolhido
   aws s3 cp "s3://highermind-backups/${BACKUP_OBJECT}" "$WORK/dump.enc" \
     --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
   ls -lh "$WORK/dump.enc"
   ```

3. Decifre (operação de leitura — não toca o banco):

   ```bash
   openssl aes-256-cbc -d -salt -in "$WORK/dump.enc" -out "$WORK/dump.pgcustom" -k "$BACKUP_KEY"
   ls -lh "$WORK/dump.pgcustom"
   ```

4. **Valide o dump ANTES de tocar a produção.** `pg_restore --list` lê o TOC sem aplicar nada — se isto falhar, o backup está corrompido; volte ao §2 e escolha outro:

   ```bash
   $COMPOSE exec -T postgres pg_restore --list /dev/stdin < "$WORK/dump.pgcustom" | head -40
   echo "TOC entries: $($COMPOSE exec -T postgres pg_restore --list /dev/stdin < "$WORK/dump.pgcustom" | grep -c ';')"
   ```

---

## 3. ⚠️ OBRIGATÓRIO — dump de segurança do estado atual

Antes de sobrescrever qualquer coisa, capture o estado corrente. Isto é o rollback do restore. **Não prossiga sem este passo.**

```bash
$COMPOSE exec -T postgres pg_dump --format=custom --compress=9 -U "$PG_USER" highermind \
  > "$WORK/PRE-RESTORE-safety.pgcustom"
ls -lh "$WORK/PRE-RESTORE-safety.pgcustom"   # confirme tamanho > 0
```

Se o banco estiver corrompido a ponto de `pg_dump` falhar, faça uma **cópia física do volume** (com Postgres parado para consistência):

```bash
$COMPOSE stop postgres
tar czf "$WORK/PRE-RESTORE-volume.tgz" -C /var/lib/docker/volumes/highermind_postgres-data .
$COMPOSE start postgres   # se for só capturar; será derrubado de novo no §4
ls -lh "$WORK/PRE-RESTORE-volume.tgz"
```

Guarde `$WORK` num caminho que sobreviva ao restore (idealmente faça upload do safety-dump pro R2 num prefixo `pre-restore/`).

---

## 4. Restaurar

> **Pare o tráfego de escrita** durante o restore para evitar inconsistência. Mantenha `postgres` de pé; derrube apenas os consumidores.

1. Quiesce os serviços que escrevem no banco (Postgres permanece up):

   ```bash
   $COMPOSE stop api web worker-inbound worker-outbound worker-media \
     worker-campaigns worker-flows scheduler agent-runtime
   ```

2. Termine conexões residuais ao DB alvo (não destrutivo — só fecha sessões):

   ```bash
   psqlc -c "
     select pg_terminate_backend(pid) from pg_stat_activity
     where datname='highermind' and pid <> pg_backend_pid();"
   ```

3. **Restore.** Escolha UM caminho:

   **Caminho A — banco íntegro, restaurar por cima (`--clean`):** dropa e recria objetos antes de restaurar. Mais rápido; preserva o database e roles.

   ```bash
   $COMPOSE exec -T postgres pg_restore \
     --clean --if-exists --no-owner --no-privileges \
     --exit-on-error -U "$PG_USER" -d highermind /dev/stdin < "$WORK/dump.pgcustom"
   ```

   **Caminho B — banco corrompido, recriar do zero:** recria o database. Mais seguro contra corrupção residual. O safety-dump do §3 é o seu rollback.

   ```bash
   psqlc -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='highermind';"
   $COMPOSE exec -T postgres dropdb   -U "$PG_USER" --if-exists highermind   # destrutivo — coberto pelo §3
   $COMPOSE exec -T postgres createdb -U "$PG_USER" -O "$PG_USER" highermind
   $COMPOSE exec -T postgres pg_restore --no-owner --no-privileges --exit-on-error \
     -U "$PG_USER" -d highermind /dev/stdin < "$WORK/dump.pgcustom"
   ```

4. Garanta extensões e re-aplique migrations pendentes (o dump custom traz extensões, mas confirme):

   ```bash
   psqlc -c "select extname from pg_extension order by 1;"
   # Esperado conter: pgcrypto, uuid-ossp, pg_trgm, citext, vector, unaccent
   # Aplique migrations se o dump for de um schema anterior ao código deployado:
   $COMPOSE run --rm api pnpm db:migrate
   ```

---

## 5. Validação de integridade (pós-restore)

Não suba a app antes de TODOS passarem.

1. Schema e contagens sanas:

   ```bash
   psqlc -c "\dt" | head
   psqlc -c "
     select 'workspaces' t, count(*) c from workspaces
     union all select 'conversations', count(*) from conversations
     union all select 'messages', count(*) from messages
     union all select 'contacts', count(*) from contacts
     union all select 'channels', count(*) from channels;"
   ```

2. **RLS ativo** (isolamento multi-tenant é fundação):

   ```bash
   psqlc -c "
     select relname, relrowsecurity from pg_class
     where relname in ('conversations','messages','contacts','channels','channel_secrets')
     order by relname;"
   # Toda linha deve ter relrowsecurity = t.
   psqlc -c "reset role; select count(*) from conversations;"   # esperado: 0 sem app.workspace_id
   ```

3. **Secrets cifrados decifram** — prova de que o dump não corrompeu `*_enc` e que a `ENCRYPTION_KEY` em prod casa com os dados restaurados:

   ```bash
   psqlc -c "select channel_id, key_version, length(access_token_enc) from channel_secrets limit 3;"
   # Teste funcional de decrypt num secret (não vaza o plaintext nos logs):
   $COMPOSE run --rm -T api node -e '
     const { decryptSecret } = require("@hm/db");
     const sample = process.env.SAMPLE_ENC;
     if (sample) { decryptSecret(sample); console.log("decrypt OK"); }
     else console.log("sem amostra — valide manualmente no painel");'
   ```

   Se o decrypt falhar com `Unsupported state or unable to authenticate data`, a `ENCRYPTION_KEY` em prod **não** corresponde aos dados restaurados → o backup é de outra época de chave. Faça rollback (§7) e vá para [`rotate-encryption-key.md`](./rotate-encryption-key.md) antes de seguir.

4. Integridade referencial / chaves estrangeiras não violadas:

   ```bash
   psqlc -c "
     select conrelid::regclass as table, conname from pg_constraint
     where contype='f' limit 5;"   # smoke: FKs existem
   ```

---

## 6. Smoke test pós-restore (subir e provar fim-a-fim)

1. Suba a stack de app de volta:

   ```bash
   $COMPOSE up -d api web worker-inbound worker-outbound worker-media \
     worker-campaigns worker-flows scheduler agent-runtime
   sleep 15
   ```

2. Health endpoints:

   ```bash
   curl -fsS http://localhost:3001/health
   $COMPOSE exec -T api curl -fsS http://web:3000/api/healthz
   $COMPOSE exec -T api curl -fsS http://agent-runtime:8001/healthz
   ```

3. Login + leitura tenant-scoped via UI (`app.<domínio>`): autentique com uma conta de teste, abra uma conversa, confirme que mensagens históricas aparecem.

4. Workers drenando RabbitMQ sem erro (`mq.<domínio>` ou logs):

   ```bash
   $COMPOSE logs --tail=50 worker-inbound | grep -i -E 'ready|ack|processed'
   ```

5. Confirme que o cron de backup volta a operar (não quer ficar sem RPO após o incidente): cheque o `scheduler` no próximo ciclo ou force um backup manual de validação.

**Resolvido quando:** §5 todo verde + §6 health 3/3 OK + login lê dados + workers sem erro.

---

## 7. Rollback (o restore piorou as coisas)

O §3 existe exatamente para isto.

1. Pare a app de novo:

   ```bash
   $COMPOSE stop api web worker-inbound worker-outbound worker-media worker-campaigns worker-flows scheduler agent-runtime
   psqlc -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='highermind';"
   ```

2. Restaure o safety-dump capturado no §3:

   ```bash
   $COMPOSE exec -T postgres dropdb   -U "$PG_USER" --if-exists highermind
   $COMPOSE exec -T postgres createdb -U "$PG_USER" -O "$PG_USER" highermind
   $COMPOSE exec -T postgres pg_restore --no-owner --no-privileges --exit-on-error \
     -U "$PG_USER" -d highermind /dev/stdin < "$WORK/PRE-RESTORE-safety.pgcustom"
   ```

   Se você só tem a cópia física do volume (`PRE-RESTORE-volume.tgz`):

   ```bash
   $COMPOSE stop postgres
   # Esvaziar o volume e reidratar a partir do tar (destrutivo — mas é o rollback intencional):
   docker run --rm -v highermind_postgres-data:/data -v "$WORK":/bk alpine \
     sh -c 'rm -rf /data/* && tar xzf /bk/PRE-RESTORE-volume.tgz -C /data'
   $COMPOSE up -d postgres
   ```

3. Re-rode a validação do §5 contra o estado restaurado e reavalie a estratégia.

---

## 8. Pós-incidente

- Registre: qual backup foi usado, RPO real (delta entre o dump e o momento do incidente), RTO real.
- Se o decrypt falhou em §5.3, documente a época de chave do backup e cruze com [`rotate-encryption-key.md`](./rotate-encryption-key.md).
- Reforce a cadência de teste de restore mensal em staging (`INFRASTRUCTURE.md` §5.5) — incidente real é prova de que valeu a pena.
