# Runbook — Worker em crash-loop / caído (produção)

> **Para quem:** SRE / on-call da Leadium respondendo ao serviço de workers reiniciando em loop ou parado — sob pressão.
> **Ambiente:** VPS Ubuntu, **Docker Swarm** (stack `leadium`). Serviço `leadium_workers` = **um processo** (`apps/workers/src/main.ts` via `tsx`) que sobe TODOS os consumers (inbound, outbound, media, flows, campaigns, coexistence, kb, billing, scheduler). `replicas: 1`, `restart_policy: on-failure` (delay 10s, `max_attempts: 5`), limite de memória **512M**. **Sem healthcheck HTTP** — a resiliência vem do restart do Swarm + shutdown gracioso (SIGTERM).
> **Severidade:** **SEV1** — com os workers fora, nada é processado: inbound de canais não persiste/responde, flows e campanhas param, filas RabbitMQ acumulam (ver [`incident-rabbitmq-backlog.md`](./incident-rabbitmq-backlog.md)).
> **Comandos são bash (Linux/prod). Nunca PowerShell.**

> ⚠️ **`max_attempts: 5` esconde o problema.** Depois de 5 falhas rápidas, o Swarm **para de reiniciar** a task e o serviço fica com 0/1 réplica — parece "estável" mas está morto. Sempre confira `docker service ls` (coluna `REPLICAS`) além dos logs.

---

## 0. Convenções

```bash
cd /opt/leadium
export STACK=leadium
set -a; . /opt/leadium/.env; set +a
WCID() { docker ps -qf "name=${STACK}_workers" | head -1; }   # vazio se não há task rodando
```

---

## 1. Sintomas / Detecção

Você chega aqui por:

- Filas RabbitMQ com `consumers = 0` (encaminhado de [`incident-rabbitmq-backlog.md`](./incident-rabbitmq-backlog.md) §2).
- Alerta de ausência de métrica `hm_worker_jobs_processed_total` (parou de reportar).
- Cockpit sem processar inbound/flows; nada é entregue.

Confirme o estado real:

```bash
# 1. Quantas réplicas estão de fato rodando? (0/1 = morto e sem retry)
docker service ls --filter name=${STACK}_workers

# 2. Histórico das tasks: por que morreram? (Failed/Rejected + mensagem de erro)
docker service ps ${STACK}_workers --no-trunc

# 3. Logs recentes — a causa quase sempre está nas últimas linhas antes do exit:
docker service logs --tail=200 ${STACK}_workers

# 4. Foi OOM? (exit 137 = SIGKILL por limite de memória)
CID=$(WCID); [ -n "$CID" ] && docker inspect "$CID" \
  --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
```

Interprete:

| Sinal | Diagnóstico provável | Vá para |
|---|---|---|
| Loop de `Failed` logo após deploy; `service ps` do anterior estava `Running` | **Deploy ruim** (erro no boot: código, migration, env novo) | §2 |
| `exit=137` / `oom=true` no `inspect` | **OOM kill** (>512M) | §3 |
| Log com `ECONNREFUSED`/`ENOTFOUND` para `postgres`/`redis`/`rabbitmq` | **Dependência fora** | §4 |
| Log com `unhandledRejection`/`uncaughtException` e stack de código | Bug de runtime derrubando o processo | §5 |
| `REPLICAS 0/1` e `service ps` sem retry recente | Esgotou `max_attempts` — Swarm desistiu | §6 (force redeploy) após tratar a causa |

---

## 2. Deploy ruim (crash logo após um deploy)

Se o crash-loop começou **imediatamente após um deploy**, o caminho mais rápido e seguro é **reverter**, não depurar em produção.

1. Confirme a correlação temporal (a versão da imagem é o sha do commit):

   ```bash
   docker service inspect ${STACK}_workers \
     --format '{{index .Spec.TaskTemplate.ContainerSpec.Image}}'      # leadium-workers:<sha>
   git -C /opt/leadium log --oneline -5
   ```

2. Reverta agora e depure depois → siga [`rollback-deploy.md`](./rollback-deploy.md). O caminho rápido para um único serviço:

   ```bash
   docker service rollback ${STACK}_workers
   ```

3. Se o boot falha por **migration** (o novo código espera colunas que não existem, ou a migration em si falhou no deploy), veja o log de migration do deploy e trate o schema antes de qualquer redeploy — cross-ref [`rollback-deploy.md`](./rollback-deploy.md) §4 (migrations são forward-only).

4. Verifique a recuperação (§7).

---

## 3. OOM kill (`exit=137`)

O processo cruzou o limite de 512M e foi morto; o Swarm reinicia, ele reenche a memória e morre de novo (loop).

1. Confirme e veja a pressão de RAM do host (8 GB, sem folga):

   ```bash
   dmesg -T | grep -i -E 'killed process|out of memory' | tail
   free -h
   docker stats --no-stream
   ```

2. Causas comuns e ação:
   - **Backlog gigante sendo puxado** (prefetch alto × mensagens grandes de mídia): drene as filas primeiro ([`incident-rabbitmq-backlog.md`](./incident-rabbitmq-backlog.md)); a pressão cede.
   - **Vazamento** após um deploy: reverta (§2) e abra investigação de memória fora do horário de pico.
   - **Host sem swap**: confirme swap ativo (o bootstrap recomenda 4G — `deploy-production.md` §2.2):

     ```bash
     swapon --show     # se vazio: fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
     ```

3. Se o volume de trabalho é legítimo e recorrente, eleve `deploy.resources.limits.memory` do serviço `workers` no `infra/docker/docker-compose.prod.yml` e redeploy (`scripts/deploy.sh main`) — **último recurso**, só se a RAM do host comportar.

4. Verifique (§7).

---

## 4. Dependência fora (Postgres / Redis / RabbitMQ)

O worker não sobe (ou cai no boot) porque uma dependência não responde.

1. Identifique qual falha no log:

   ```bash
   docker service logs --tail=120 ${STACK}_workers | grep -iE 'econnrefused|enotfound|getaddrinfo|amqp|redis|postgres|timeout'
   ```

2. Cheque a saúde de cada dependência (todas na rede interna, sem porta no host):

   ```bash
   docker service ps ${STACK}_postgres ${STACK}_redis ${STACK}_rabbitmq --no-trunc | grep -vi shutdown
   docker exec -i "$(docker ps -qf name=${STACK}_postgres | head -1)" pg_isready -U "$PG_USER" -d "$PG_DB"
   docker exec -i "$(docker ps -qf name=${STACK}_redis | head -1)" redis-cli ping
   docker exec -i "$(docker ps -qf name=${STACK}_rabbitmq | head -1)" rabbitmq-diagnostics -q ping
   ```

3. Trate a dependência que estiver fora:
   - Postgres → [`incident-postgres-down.md`](./incident-postgres-down.md).
   - RabbitMQ com alarme/backlog → [`incident-rabbitmq-backlog.md`](./incident-rabbitmq-backlog.md).
   - Redis parado → `docker service update --force ${STACK}_redis`.

   Com a dependência de volta, o Swarm reinicia os workers sozinho (se ainda dentro do `max_attempts`); senão, force o redeploy (§6).

4. Verifique (§7).

---

## 5. Bug de runtime (`unhandledRejection` / exceção não tratada)

O processo morre por uma exceção de código, não por infra. Historicamente os workers **morriam por falta de handler de `unhandledRejection`** (memória `tagix-livechat-realtime-cockpit`) — se o log mostrar rejection sem handler, é regressão desse tipo.

1. Extraia a exceção e o worker/handler culpado:

   ```bash
   docker service logs --tail=300 ${STACK}_workers | grep -iE 'unhandled|uncaught|Error:|at .*\.ts' | tail -40
   ```

2. Se é uma **mensagem-veneno** (um payload específico derruba o handler antes de o retry/DLQ agir): não fique reiniciando contra ela. Identifique a fila de origem no log e, se possível, mova a mensagem para a DLQ manualmente ou pause aquele consumer via redeploy com a correção. Não `purgue` a fila inteira por causa de uma mensagem.

3. Se é regressão de código → **reverta** (§2 / [`rollback-deploy.md`](./rollback-deploy.md)) e corrija na branch. Não deixe o serviço em loop consumindo CPU/RAM.

4. Verifique (§7).

---

## 6. Serviço parado sem retry (esgotou `max_attempts`)

Quando `REPLICAS` mostra `0/1` e não há tentativa recente, o Swarm desistiu. **Só force o redeploy depois de tratar a causa** (§2–§5) — senão volta a estourar as 5 tentativas.

```bash
# Recria a task do zero (relê a spec atual; a topologia AMQP é idempotente no boot):
docker service update --force ${STACK}_workers
docker service ps ${STACK}_workers --no-trunc | head
```

Se o boot ainda falha por causa não resolvida, **pare** e volte ao diagnóstico (§1) — reiniciar em loop não conserta.

---

## 7. Verificação de recuperação ("resolvido")

Considere resolvido **somente** quando TODOS passarem:

1. Serviço estável — 1/1 réplica, sem novas falhas por alguns minutos:

   ```bash
   docker service ls --filter name=${STACK}_workers      # REPLICAS 1/1
   docker service ps ${STACK}_workers --no-trunc | head  # última task Running, sem loop
   ```

2. Consumers religados no broker (a fila voltou a ter quem drene):

   ```bash
   docker exec -i "$(docker ps -qf name=${STACK}_rabbitmq | head -1)" \
     rabbitmqctl list_queues name consumers messages | grep -E 'inbound|outbound|flows'
   ```

3. Backlog drenando (se acumulou durante a queda) → siga [`incident-rabbitmq-backlog.md`](./incident-rabbitmq-backlog.md) §3 até zerar.

4. Prova ponta-a-ponta: envie uma mensagem de teste por um canal e confirme que persiste e responde; `curl -fsS http://localhost:3001/health` → `ok`.

5. Logs "quentes" sem erros novos:

   ```bash
   docker service logs --tail=50 ${STACK}_workers | grep -iE 'processed|ack|ready'
   ```

---

## 8. Pós-incidente

- Registre causa-raiz (deploy / OOM / dependência / bug), MTTR e se foi preciso reverter.
- Se foi OOM: abra follow-up de alerta proativo (`docker stats` / `hm_worker_queue_depth`) e reavalie prefetch de mídia.
- Se foi `unhandledRejection`: garanta que o handler global de rejeição existe no bootstrap (regressão conhecida — não deixe voltar).
- Se o `max_attempts` mascarou a queda, considere alerta sobre `REPLICAS 0/1` no monitor de serviços, não só sobre logs.
