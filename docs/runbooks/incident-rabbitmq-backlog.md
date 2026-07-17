# Runbook — RabbitMQ com backlog / fila estourada / DLQ cheia (produção)

> **Para quem:** SRE / on-call da Leadium respondendo a filas crescendo sem drenar, publishers bloqueados ou DLQ enchendo — sob pressão.
> **Ambiente:** VPS Ubuntu, **Docker Swarm** (stack `leadium`, `scripts/deploy.sh`). Broker `rabbitmq:3.13-management-alpine`, serviço `leadium_rabbitmq`, na rede interna `leadium_leadium_internal` — **sem porta publicada no host** (a UI de management em `:15672` NÃO está exposta; toda inspeção é via `docker exec` no container do broker).
> **Severidade:** **SEV1** se inbound de canais para de ser processado (mensagens de cliente não persistem/respondem); **SEV2** se só filas secundárias (media/kb/campaigns) acumulam.
> **Comandos são bash (Linux/prod). Nunca PowerShell — prod é o único contexto bash do projeto.**

> ⚠️ **`purge` é a última opção.** Esvaziar uma fila (`hm.q.dlq` inclusive) **descarta trabalho de cliente permanentemente**. Este runbook só chega ao `purge` no §6, depois de inspeção e replay. Prefira sempre `replay` (reprocessa) a `purge` (descarta).

---

## 0. Convenções

```bash
cd /opt/leadium
export STACK=leadium
set -a; . /opt/leadium/.env; set +a   # RABBITMQ_USER, RABBITMQ_PASSWORD, etc.

# O broker não tem porta no host: opere DENTRO do container do serviço.
RABBIT_CID() { docker ps -qf "name=${STACK}_rabbitmq" | head -1; }
rmq()  { docker exec -i "$(RABBIT_CID)" rabbitmqctl "$@"; }
rdiag(){ docker exec -i "$(RABBIT_CID)" rabbitmq-diagnostics "$@"; }
```

Topologia de filas (de `@hm/shared/mq`):

| Fila | Papel | Confiável (retry+DLQ)? |
|---|---|---|
| `hm.q.inbound` | mensagens recebidas dos canais (cliente-facing) | sim |
| `hm.q.outbound` | envios para os canais | sim |
| `hm.q.media` | download/upload de mídia | sim |
| `hm.q.flows` / `hm.q.flow.execution` | execução de flows | sim |
| `hm.q.campaigns` | disparo de campanhas | sim |
| `hm.q.coexistence` | echoes/history da Coexistência WABA | sim |
| `hm.q.kb_ingest` | ingestão de KB/embeddings | sim |
| `hm.q.<origem>.retry.<ttl>` | **wait-queues** de backoff (5s/30s/2min/10min/30min) | — |
| `hm.q.dlq` | fila final: esgotou retries ou conteúdo inválido | — |

Exchanges: `hm.events` (topic, roteia trabalho) e `hm.dlx` (topic, dead-letter/retry).
As filas confiáveis têm a "retry ladder": em falha transitória o `consume` republica na wait-queue do próximo TTL; esgotadas as tentativas, cai na `hm.q.dlq` (ver `retry.ts`).

---

## 1. Sintomas / Detecção

Você chega aqui por um destes sinais:

- Alerta de profundidade de fila (métrica `hm_worker_queue_depth`, Grafana) subindo e não voltando.
- Cockpit/LiveChat: mensagens recebidas demoram a aparecer ou respostas de flow/agente atrasam.
- `api` logando `publish backpressure` / `write buffer cheio`, ou publishers "travando".
- DLQ crescendo (mensagens sendo dead-lettered em volume).

Confirme o estado real **antes de agir**:

```bash
# 1. O broker está de pé e saudável?
docker service ps ${STACK}_rabbitmq --no-trunc
rdiag -q ping                       # deve responder "Ping succeeded"
rdiag alarms                        # deve ser vazio; ver §4 se houver alarme

# 2. Profundidade e consumidores de CADA fila (a foto mais importante):
rmq list_queues name messages messages_ready messages_unacked consumers | sort

# 3. Só a DLQ e as wait-queues (para separar "atraso" de "falha real"):
rmq list_queues name messages | grep -E 'dlq|retry'
```

Interprete `list_queues`:

| Sinal | Diagnóstico provável | Vá para |
|---|---|---|
| `consumers = 0` numa fila de trabalho | **Workers caídos** ou não conectados | §2 → e `incident-worker-crash-loop.md` |
| `messages_ready` alto, `consumers > 0`, `messages_unacked` baixo e **não** cai | Handler lento (DB/rede) ou throughput insuficiente | §3 |
| `messages_unacked` alto e estagnado | Mensagens em processamento travadas (handler pendurado / lock) | §3 |
| `rdiag alarms` mostra `memory`/`disk` | Broker **bloqueou publishers** (high watermark) | §4 |
| `hm.q.dlq` crescendo | Mensagens esgotando retries / conteúdo inválido | §5 |
| Só `*.retry.*` inchadas, DLQ estável | Erro transitório em massa (ex.: DB piscou) — **auto-drena** após o TTL | §3 passo 4 |

---

## 2. Fila sem consumidores (`consumers = 0`)

A fila enche porque ninguém consome. A causa está nos workers, não no broker.

1. Cheque o serviço de workers:

   ```bash
   docker service ps ${STACK}_workers --no-trunc | head
   docker service logs --tail=100 ${STACK}_workers
   ```

2. Se as tasks estão `Failed`/`Rejected`/reiniciando → siga [`incident-worker-crash-loop.md`](./incident-worker-crash-loop.md). Volte aqui depois que os consumers reaparecerem.

3. Se o serviço está `Running` mas `consumers = 0`, o processo subiu mas não abriu os consumers (falha de conexão AMQP). Confirme a conexão do worker ao broker:

   ```bash
   rmq list_connections user peer_host state | grep -i "${RABBITMQ_USER}"
   docker service logs --tail=80 ${STACK}_workers | grep -iE 'amqp|rabbit|connect|econnrefused'
   ```

   Force um restart controlado dos workers (Swarm recria a task; a topologia é idempotente no boot):

   ```bash
   docker service update --force ${STACK}_workers
   ```

4. Verifique que os consumers voltaram (§7).

---

## 3. Consumidores presentes mas fila não drena

Workers estão consumindo, mas o throughput não vence o acúmulo.

1. Meça a **taxa** de drenagem (duas fotos com 10s de intervalo — se `messages` não cai, os handlers estão travados; se cai devagar, é volume):

   ```bash
   for i in 1 2 3; do rmq list_queues name messages_ready messages_unacked | grep -E 'inbound|outbound|media|flows'; echo '---'; sleep 10; done
   ```

2. Cheque a dependência mais provável de estar lenta (o handler segura a mensagem em `unacked` enquanto espera o DB):

   ```bash
   curl -fsS http://localhost:3001/health          # db/redis do lado da app
   docker service logs --tail=120 ${STACK}_workers | grep -iE 'timeout|slow|deadlock|econnreset'
   ```

   Se o Postgres está degradado → [`incident-postgres-down.md`](./incident-postgres-down.md) é a causa-raiz; resolva lá e o backlog drena sozinho.

3. **Escale os workers horizontalmente** para aumentar a vazão. O lock de ordenação por conversa é distribuído via Redis (LIVECHAT.md §3.4), então rodar N réplicas é seguro — não quebra o FIFO por conversa:

   ```bash
   docker service scale ${STACK}_workers=3
   docker service ps ${STACK}_workers        # confirme as 3 tasks Running
   ```

   > Cuidado com RAM: cada réplica reserva ~224M (limite 512M) num host de 8 GB. Cheque `docker stats --no-stream` antes de passar de 3. Volte a `=1` depois que o backlog drenar (§7).

4. Se só as **wait-queues** (`*.retry.*`) estão inchadas e a DLQ está estável: foi um erro transitório em massa (ex.: DB piscou 2 min). As mensagens voltam sozinhas à origem quando o TTL expira (5s→30s→2min→10min→30min). **Não** faça nada destrutivo — monitore o dreno:

   ```bash
   watch -n 5 "docker exec -i \$(docker ps -qf name=${STACK}_rabbitmq | head -1) rabbitmqctl list_queues name messages | grep retry"
   ```

---

## 4. Broker bloqueando publishers (alarme de memória/disco)

O RabbitMQ, ao cruzar o high watermark de memória (40% da RAM do container por padrão) ou o limite de disco livre, **bloqueia todas as conexões que publicam** — a `api` trava ao enfileirar inbound. É a causa nº 1 de "tudo parou de uma vez".

1. Confirme o alarme e o que consome memória:

   ```bash
   rdiag alarms                       # ex.: "resource_limit ... memory"
   rdiag memory_breakdown
   rmq list_queues name messages messages_ram | sort -k2 -n | tail
   ```

2. A causa quase sempre é **uma fila gigante em memória** (por não drenar) — ou seja, sintoma de §2/§3. Ataque a raiz: suba consumers (§2/§3) para a fila esvaziar e o alarme limpar sozinho.

3. Se for **disco cheio no host** (o volume `leadium_rabbitdata` mora em `/var/lib/docker`):

   ```bash
   df -h /
   docker image prune -af && docker builder prune -af     # descartável; NÃO `docker volume prune`
   ```

4. Alívio imediato **sem perder mensagem** (dá fôlego para os consumers drenarem): mensagens `ready` de filas duráveis podem ser paginadas para disco; garanta que os consumers estão de pé (§2). Só considere elevar o limite do container (`deploy.resources.limits.memory` de `leadium_rabbitmq` no compose + redeploy) se o volume for legítimo e recorrente — não como band-aid de vazamento.

5. Verifique que o alarme limpou:

   ```bash
   rdiag alarms                       # deve voltar vazio
   ```

---

## 5. DLQ cheia — inspecionar, corrigir causa e reprocessar

`hm.q.dlq` guarda o que esgotou retries (`max_retries_exhausted`) ou é conteúdo inválido (`invalid_envelope`/`non_retryable`). **Nada aqui se perde sozinho** — é seu para triar.

1. Inspecione **sem remover** (a CLI lê e devolve à DLQ). Rode dentro do container de workers (o `.env` já está injetado pelo compose; WORKDIR = `/app/apps/workers`):

   ```bash
   WCID=$(docker ps -qf "name=${STACK}_workers" | head -1)
   docker exec -i "$WCID" pnpm exec tsx src/dlq/cli.ts inspect --max 100
   ```

   A saída lista, por mensagem: `originQueue`, `retries`, `reason`, `error`, `failedAt`. Agrupe pela `reason` e pelo `error` para achar o padrão dominante.

2. **Decida pela causa** (`reason`):

   | `reason` | Significado | Ação |
   |---|---|---|
   | `max_retries_exhausted` | erro transitório que persistiu por todos os TTLs (ex.: DB fora > 40 min) | corrija a dependência, depois **replay** (passo 3) |
   | `invalid_envelope` | JSON malformado / envelope reprovado no Zod | **não** dá replay às cegas — é bug de produtor; abra correção. Replay só repete a falha |
   | `non_retryable` | regra de negócio rejeitou (provider desconhecido, etc.) | idem — investigar antes de qualquer replay |

3. **Reprocessar (replay)** — só depois que a causa-raiz foi corrigida. Reenvia cada mensagem à sua fila de origem (header `x-hm-origin-queue`) e zera o contador de retries por padrão:

   ```bash
   # Comece pequeno para validar que agora processa:
   docker exec -i "$WCID" pnpm exec tsx src/dlq/cli.ts replay --max 10
   # Observe a fila de origem drenar sem voltar à DLQ; então processe o resto:
   docker exec -i "$WCID" pnpm exec tsx src/dlq/cli.ts replay --max 1000
   ```

   Flags: `--keep-retries` preserva o contador (a mensagem terá menos tentativas antes de voltar à DLQ) — útil se você suspeita que a causa pode reincidir e não quer um loop.

4. Se após o replay as mensagens **voltam** à DLQ, a causa não foi resolvida — pare de dar replay (você está em loop) e volte ao passo 2.

---

## 6. Último recurso — `purge` (destrutivo)

Só quando as mensagens são comprovadamente lixo (ex.: `invalid_envelope` de um produtor bugado já corrigido, sem valor de negócio) **e** você já inspecionou (§5.1). O `purge` descarta e não há volta.

```bash
# Registre antes o que vai apagar (contagem + amostra do inspect acima):
docker exec -i "$(docker ps -qf name=${STACK}_rabbitmq | head -1)" \
  rabbitmqctl list_queues name messages | grep dlq

# Esvazia SÓ a DLQ (não toque nas filas de trabalho):
docker exec -i "$WCID" pnpm exec tsx src/dlq/cli.ts purge
```

Purgar uma fila de **trabalho** (`hm.q.inbound`, etc.) é ainda mais grave — só num incidente onde o conteúdo é comprovadamente irreproduzível e nocivo. Documente a justificativa no pós-incidente.

---

## 7. Verificação de recuperação ("resolvido")

Considere resolvido **somente** quando TODOS passarem:

1. Sem alarmes no broker:

   ```bash
   rdiag alarms          # vazio
   rdiag -q ping         # Ping succeeded
   ```

2. Filas de trabalho drenando (profundidade estável/baixa, consumers > 0):

   ```bash
   rmq list_queues name messages messages_ready consumers | sort
   ```

3. DLQ não cresce mais (a taxa de dead-letter voltou a ~0):

   ```bash
   for i in 1 2; do rmq list_queues name messages | grep dlq; sleep 15; done
   ```

4. App saudável e ponta-a-ponta: `curl -fsS http://localhost:3001/health` → `ok`; envie uma mensagem de teste por um canal e confirme que persiste e responde.

5. Se escalou os workers no §3, volte à baseline após drenar:

   ```bash
   docker service scale ${STACK}_workers=1
   ```

---

## 8. Pós-incidente

- Registre timeline, causa-raiz, pico de profundidade e MTTR.
- Se a causa foi dependência (Postgres/rede), cruze com [`incident-postgres-down.md`](./incident-postgres-down.md).
- Se a DLQ encheu por `invalid_envelope`/`non_retryable`, abra follow-up de correção no **produtor** (o replay não conserta bug de origem).
- Se faltou visibilidade, garanta que `WORKERS_METRICS_PORT` está setado e o alerta de `hm_worker_queue_depth` no Grafana dispara antes do backlog virar SEV1.
