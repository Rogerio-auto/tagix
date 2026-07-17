# Runbook — Rollback de deploy (produção)

> **Para quem:** SRE / on-call da Leadium desfazendo um deploy que quebrou produção — sob pressão, com clientes afetados.
> **Ambiente:** VPS Ubuntu, **Docker Swarm** (stack `leadium`, dir `/opt/leadium`, `scripts/deploy.sh`). As imagens são **tagueadas pelo commit** (`leadium-api:<sha>`, `leadium-workers:<sha>`, etc.) — `deploy.sh` deriva `APP_VERSION = git rev-parse --short HEAD`. É isso que torna o rollback determinístico.
> **Severidade:** acompanha o incidente que motivou o rollback (normalmente **SEV1/SEV2**).
> **Comandos são bash (Linux/prod). Nunca PowerShell.**

> ⚠️ **Rollback de CÓDIGO não é rollback de DADOS.** As migrations do Drizzle são **forward-only** — voltar o código NÃO desfaz uma migration já aplicada. Se o deploy ruim rodou uma migration **destrutiva** (drop/rename de coluna, backfill que apaga dados), reverter o código pode deixá-lo incompatível com o schema, ou o dado já se perdeu. Nesse caso o rollback verdadeiro é [`restore-from-backup.md`](./restore-from-backup.md), não este runbook. Leia o §4 **antes** de reverter.

---

## 0. Convenções

```bash
cd /opt/leadium
export STACK=leadium
set -a; . /opt/leadium/.env; set +a
```

Serviços do stack: `leadium_api`, `leadium_web`, `leadium_workers`, `leadium_agent-runtime`, `leadium_landing` (código) + `leadium_postgres`, `leadium_redis`, `leadium_rabbitmq` (infra própria).

---

## 1. Quando reverter (e quando NÃO)

**Reverta** quando um deploy recente causou: 5xx generalizado, crash-loop ([`incident-worker-crash-loop.md`](./incident-worker-crash-loop.md)), regressão funcional grave, ou o serviço não converge (`REPLICAS 0/N`).

**Não reverta às cegas** se: o deploy rodou migration destrutiva (§4), ou o problema é infra (Postgres/Redis/RabbitMQ fora) e não código — nesse caso trate a infra pelo runbook específico; reverter código não resolve.

Antes de tudo, capture o estado para saber para onde voltar:

```bash
# Versão (sha) rodando AGORA em cada serviço de código:
for s in api web workers agent-runtime landing; do
  printf '%-14s ' "$s"
  docker service inspect ${STACK}_$s --format '{{index .Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null
done

# Histórico de commits (o alvo do rollback é o último bom conhecido):
git -C /opt/leadium log --oneline -8
```

---

## 2. Caminho rápido — `docker service rollback` (um serviço, sem rebuild)

O Swarm guarda a **spec anterior** de cada serviço. `docker service rollback` volta o serviço para a imagem `<sha>` anterior **instantaneamente**, desde que a imagem daquele sha ainda exista no nó (existe, se foi o deploy imediatamente anterior). É o caminho mais rápido quando **um único serviço** quebrou.

```bash
# Ex.: o último deploy quebrou só os workers:
docker service rollback ${STACK}_workers

# Acompanhe a convergência:
docker service ps ${STACK}_workers --no-trunc | head
docker service ls --filter name=${STACK}_workers      # REPLICAS deve voltar a 1/1
```

Quando usar: regressão isolada em **um** serviço, **sem** mudança de migration entre as duas versões.

Limites (vá para o §3 se qualquer um bater):
- Reverte só **uma** spec para trás (não encadeia vários rollbacks).
- Se a imagem `<sha>` anterior foi podada do nó (`docker image prune`), não há o que reverter → §3.
- Se o problema envolve **vários** serviços ou o schema, `service rollback` isolado deixa o stack **inconsistente** → §3.

Pule para o §5 (verificação) após o rollback.

---

## 3. Caminho completo — redeploy do commit anterior (stack inteiro)

Reconstrói e redeploya o stack inteiro no commit bom conhecido. É o rollback autoritativo: garante que TODOS os serviços e a spec do stack batem com aquele ponto no tempo. Usa exatamente o `deploy.sh`, então é idempotente e testado.

1. Aponte a árvore para o commit alvo (o último bom do §1):

   ```bash
   git -C /opt/leadium fetch --all --prune
   git -C /opt/leadium reset --hard <sha-anterior-bom>
   git -C /opt/leadium rev-parse --short HEAD          # confirme o alvo
   ```

2. Rode o deploy padrão. Ele re-tagueia as imagens com o sha alvo e faz `stack deploy` (rolling update):

   ```bash
   sudo bash /opt/leadium/scripts/deploy.sh main
   ```

   > **Por que `deploy.sh` e não `docker service update --image`:** o `deploy.sh` reaplica o compose inteiro (labels do Traefik, env, redes, migrations) de forma consistente. Um `--image` avulso pode deixar env/labels da versão nova pendurados.
   >
   > **Gotcha do Swarm (crítico):** com tag fixa (`:latest`) o `stack deploy` **não recria** o serviço (compara a string da tag). É por isso que tagueamos por `<sha>` — o alvo do rollback tem uma tag diferente da versão ruim, então o Swarm detecta e recria. Se a imagem `<sha>` alvo ainda estiver no nó, o build é instantâneo (cache); senão, ele rebuilda daquele código.

3. O `deploy.sh` também roda migrations (passo 6). Se o commit alvo tem um schema **anterior**, o `@hm/db migrate` não desfaz nada (forward-only) — apenas não há migration nova a aplicar. Se ele **falhar** por incompatibilidade, é sinal de que há uma migration destrutiva no meio → §4.

Pule para o §5.

---

## 4. Rollback com migration no meio (decisão obrigatória)

Se entre a versão ruim e o alvo existe **qualquer migration**, decida antes de reverter:

1. Descubra se o deploy ruim aplicou migration nova:

   ```bash
   git -C /opt/leadium log --oneline <sha-anterior-bom>..<sha-ruim> -- packages/db/migrations
   ```

2. Classifique a migration:

   | Tipo | Efeito de reverter só o código | Ação |
   |---|---|---|
   | **Aditiva** (nova tabela/coluna nullable, novo índice) | Código antigo ignora o que sobra — seguro | Reverta código normalmente (§2/§3); deixe o schema à frente |
   | **Destrutiva** (drop/rename de coluna, `NOT NULL` novo, backfill que apaga) | Código antigo pode quebrar **ou** o dado já se perdeu | **Não** basta reverter código → §4.3 |

3. Para migration destrutiva, o rollback real é de **dados**:
   - Se dados foram perdidos/alterados irreversivelmente → [`restore-from-backup.md`](./restore-from-backup.md) (restaura do dump; o §3 daquele runbook captura o estado atual antes de sobrescrever).
   - Se o schema mudou mas os dados estão intactos, prefira **corrigir para frente** (forward-fix): uma migration nova que restaura a compatibilidade, deployada por `deploy.sh`. Reverter para um schema mais antigo que o do banco é fonte de inconsistência silenciosa.

4. Nunca rode `git reset` + `deploy.sh` para um commit **anterior** a uma migration destrutiva esperando que "volte" o schema — não volta. Decida entre restore (dados) ou forward-fix (schema).

---

## 5. Verificação de recuperação ("resolvido")

Considere o rollback bem-sucedido **somente** quando TODOS passarem:

1. Todos os serviços convergidos (réplicas cheias, sem loop):

   ```bash
   docker stack services ${STACK}
   docker service ps ${STACK}_api ${STACK}_workers ${STACK}_web --no-trunc | grep -vi shutdown | head
   ```

2. Versão correta rodando (o sha alvo, não o ruim):

   ```bash
   for s in api web workers; do
     printf '%-8s ' "$s"; docker service inspect ${STACK}_$s \
       --format '{{index .Spec.TaskTemplate.ContainerSpec.Image}}'
   done
   ```

3. Health e ingress:

   ```bash
   curl -fsS http://localhost:3001/health                 # api → {"status":"ok"}
   curl -fsSI https://app.leadium.com.br | head -1        # web via Traefik → 200
   curl -fsSI https://api.leadium.com.br/health | head -1 # api pública via Traefik
   ```

4. Workers consumindo e filas drenando ([`incident-rabbitmq-backlog.md`](./incident-rabbitmq-backlog.md) §7):

   ```bash
   docker exec -i "$(docker ps -qf name=${STACK}_rabbitmq | head -1)" \
     rabbitmqctl list_queues name consumers messages | grep -E 'inbound|outbound'
   ```

5. Prova funcional: login na UI (`app.leadium.com.br`), abra uma conversa, envie/receba uma mensagem de teste ponta-a-ponta.

**Resolvido quando:** §5 todo verde + a regressão que motivou o rollback não reproduz mais.

---

## 6. Pós-incidente

- Registre: sha ruim, sha alvo, caminho usado (`service rollback` vs `deploy.sh`), houve migration? RTO real.
- **Não deixe a `main` apontando para o commit ruim.** Reverta/corrija no git (`git revert <sha-ruim>` na branch e novo deploy) para que o próximo `deploy.sh main` não re-suba a versão quebrada — o `deploy.sh` faz `reset --hard origin/main`, então a `main` remota é a fonte da verdade do que sobe.
- Se foi migration destrutiva, documente a decisão (restore vs forward-fix) e reforce revisão de migrations destrutivas no CI antes do merge.
- Abra follow-up se o rollback foi lento por imagem podada do nó — considere reter as últimas N imagens `<sha>` no host.
