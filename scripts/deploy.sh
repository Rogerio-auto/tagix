#!/usr/bin/env bash
# =============================================================================
# Leadium — deploy de produção (roda NO SERVIDOR, Ubuntu/Swarm).
#
#   sudo bash /opt/leadium/scripts/deploy.sh [branch]
#
# Ordem (F70-S22 — o schema anda ANTES do código):
#   pré-checagens -> git pull (+ re-exec) -> build das imagens :<sha>
#   -> Postgres saudável (primeira instalação: sobe SÓ o Postgres do stack)
#   -> backup fail-closed -> migrations com a imagem nova (container efêmero)
#   -> docker stack deploy -> convergência de cada serviço para :<sha>
#
# Por quê: o `stack deploy` com start-first põe a api/workers novos no ar assim
# que passam no healthcheck — e o healthcheck não olha o schema. Migrar depois
# deixava código novo rodando contra schema velho (tabela `outbox` inexistente,
# colunas novas faltando) até a migração terminar, ou para sempre se ela falhasse.
# Migrar antes é seguro porque migrations são ADITIVAS (código velho convive com
# schema novo); migration destrutiva exige expand/contract — ver
# docs/runbooks/deploy-production.md §3.1.
#
# Idempotente: rodar de novo só aplica o que mudou. NÃO toca em stacks de terceiros
# (postgres/n8n/redis externos) — a Leadium tem infra própria isolada.
# Pré-requisitos: Swarm ativo, rede `network_public`, $APP_DIR/.env preenchido.
# =============================================================================
set -euo pipefail

# Configurável só para o teste de ordem (scripts/tests/test_deploy_order.py). Em
# produção nada define APP_DIR (`sudo` limpa o ambiente) e vale o default de sempre.
APP_DIR="${APP_DIR:-/opt/leadium}"
STACK="leadium"
COMPOSE="$APP_DIR/infra/docker/docker-compose.prod.yml"
BRANCH="${1:-main}"
INTERNAL_NET="${STACK}_leadium_internal"
PG_SERVICE="${STACK}_postgres"

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step() { c "1;36" "→ $1"; }
ok()   { c "1;32" "✔ $1"; }
err()  { c "1;31" "✖ $1"; }

trap 'err "Deploy FALHOU na linha $LINENO."; exit 1' ERR

cd "$APP_DIR"

# --- 0. Pré-checagens ---------------------------------------------------------
step "Pré-checagens"
[ -f "$APP_DIR/.env" ] || { err "Falta $APP_DIR/.env (copie de .env.production.example)."; exit 1; }
docker node ls >/dev/null 2>&1 || { err "Swarm não está ativo."; exit 1; }
docker network inspect network_public >/dev/null 2>&1 || { err "Rede network_public não existe (Traefik)."; exit 1; }
ok "Ambiente válido (Swarm + network_public + .env)"

# --- 1. Código ---------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  step "Atualizando código (branch $BRANCH)"
  git fetch --all --prune
  git checkout "$BRANCH"
  BEFORE_SHA="$(git rev-parse HEAD)"
  DEPLOY_SELF_SHA="$(git rev-parse "HEAD:scripts/deploy.sh" 2>/dev/null || echo none)"
  git reset --hard "origin/$BRANCH"
  ok "Código em $(git rev-parse --short HEAD)"

  # --- 1.1 Re-exec se o PRÓPRIO script mudou -----------------------------------
  # Armadilha real, custou um deploy: o bash lê este arquivo enquanto executa. O
  # `git reset` acima troca o deploy.sh no disco, mas o que continua rodando é a
  # versão ANTIGA — então qualquer melhoria no deploy (uma etapa de backup, por
  # exemplo) só passa a valer no deploy SEGUINTE, silenciosamente.
  #
  # Pior: mudar o tamanho do arquivo durante a execução pode fazer o bash pular ou
  # repetir trechos, porque ele guarda um offset de leitura.
  #
  # Re-executar a versão nova, uma vez, resolve. `LEADIUM_DEPLOY_REEXEC` impede
  # laço infinito.
  NEW_SELF_SHA="$(git rev-parse "HEAD:scripts/deploy.sh" 2>/dev/null || echo none)"
  if [ "${LEADIUM_DEPLOY_REEXEC:-0}" != "1" ] && [ "$DEPLOY_SELF_SHA" != "$NEW_SELF_SHA" ]; then
    c "1;33" "⚠ scripts/deploy.sh mudou neste pull (${BEFORE_SHA:0:7} → $(git rev-parse --short HEAD))."
    step "Re-executando a versão nova do deploy.sh"
    export LEADIUM_DEPLOY_REEXEC=1
    exec bash "$APP_DIR/scripts/deploy.sh" "$BRANCH"
  fi
else
  c "1;33" "⚠ $APP_DIR não é um repositório git — pulando git pull (deploy do estado atual)."
fi

# --- 2. Carrega .env p/ interpolação do compose ------------------------------
set -a
# shellcheck disable=SC1091  # o .env só existe no servidor
. "$APP_DIR/.env"
set +a
export DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@postgres:5432/${PG_DB}"
# Tag das imagens pelo commit atual. CRÍTICO no Swarm: com tag fixa (:latest) o
# `stack deploy` NÃO recria os serviços (compara a string da tag, não o conteúdo),
# então mudanças de código não subiriam. Tag por sha => cada deploy é detectado.
APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo latest)"
export APP_VERSION
ok "Versão do deploy: $APP_VERSION"

# Configs do Swarm são IMUTÁVEIS: o `stack deploy` aborta com "only updates to Labels are
# allowed" quando o arquivo de uma config muda e o nome continua o mesmo (incidente de
# 27/09: a F70-S27 acrescentou alertas ao alerts.yml e travou o deploy depois das
# migrações). O nome de cada config leva o hash do conteúdo: conteúdo novo, config nova,
# e o serviço troca de config no mesmo deploy. Conteúdo igual, mesmo nome, nada muda.
config_hash() { sha256sum "$1" | cut -c1-12; }
PROMETHEUS_CONFIG_HASH="$(config_hash "$APP_DIR/infra/prometheus/prometheus.yml")"
PROMETHEUS_ALERTS_HASH="$(config_hash "$APP_DIR/infra/prometheus/alerts.yml")"
ALERTMANAGER_CONFIG_HASH="$(config_hash "$APP_DIR/infra/prometheus/alertmanager.yml")"
export PROMETHEUS_CONFIG_HASH PROMETHEUS_ALERTS_HASH ALERTMANAGER_CONFIG_HASH

# --- 3. Build das imagens no nó ----------------------------------------------
# Só constrói; nada sobe. A imagem da api é a que roda as migrations no §6.
step "Buildando imagens (api, web, workers, agent-runtime, landing) :$APP_VERSION"
docker compose --env-file "$APP_DIR/.env" -f "$COMPOSE" build
ok "Imagens construídas"

# --- 4. Postgres do stack no ar ----------------------------------------------
# Deploy de rotina: o serviço já existe (e a rede interna também) — nada a fazer.
#
# PRIMEIRA INSTALAÇÃO (serviço `${STACK}_postgres` ausente): sobe SÓ o Postgres,
# pelo próprio `docker stack deploy`, com um compose derivado que contém apenas o
# bloco `postgres:` do compose de produção + `networks:` + `volumes:`.
#
# Por que stack deploy com compose recortado, e não `docker service create`:
#   - o serviço nasce com os MESMOS nomes que o stack completo usa (serviço
#     `leadium_postgres`, rede `leadium_leadium_internal` com o alias `postgres`,
#     volume `leadium_leadium_pgdata`) e com o label de namespace do stack. O
#     `stack deploy` completo logo depois reconhece tudo como seu e não recria o
#     Postgres: a spec é idêntica;
#   - o bloco vem recortado do compose de produção, então não existe uma segunda
#     definição do Postgres para divergir. Um `service create` reescreveria à mão
#     env, healthcheck, placement, limites, rede e volume, e qualquer diferença
#     viraria um restart do banco no primeiro deploy completo;
#   - `docker compose config` NÃO serve para recortar: ele prefixa volumes e redes
#     com o nome do projeto compose, e o Postgres montaria um volume VAZIO.
# Sem --prune aqui: numa stack parcial, --prune removeria o que já existisse.
if docker service inspect "$PG_SERVICE" >/dev/null 2>&1; then
  ok "Serviço $PG_SERVICE já existe (deploy de rotina)"
else
  c "1;33" "⚠ Serviço $PG_SERVICE não existe — PRIMEIRA INSTALAÇÃO (ou stack removido)."
  step "Subindo só o Postgres do stack '$STACK' (o resto sobe depois das migrations)"
  PG_COMPOSE="$(mktemp "${TMPDIR:-/tmp}/leadium-postgres-only.XXXXXX")"
  # Recorte por indentação (layout do compose: chaves de topo na coluna 0, serviços
  # com 2 espaços). Comentários de topo não trocam a seção corrente.
  awk '
    /^[A-Za-z_][A-Za-z0-9_.-]*:/ { section = $0; sub(/:.*/, "", section); svc = "" }
    section == "services" && /^  [A-Za-z0-9_.-]+:/ { svc = $0; sub(/^  /, "", svc); sub(/:.*/, "", svc) }
    section == "services" && /^services:/ { print; next }
    section == "services" && svc == "postgres" { print; next }
    section == "networks" || section == "volumes" { print }
  ' "$COMPOSE" > "$PG_COMPOSE"
  if ! grep -q '^  postgres:' "$PG_COMPOSE" || ! grep -q '^networks:' "$PG_COMPOSE" \
     || ! grep -q '^volumes:' "$PG_COMPOSE" \
     || grep -qE '^  (api|workers|web|redis|rabbitmq):' "$PG_COMPOSE"; then
    rm -f "$PG_COMPOSE"
    err "Não consegui recortar o bloco do Postgres de $COMPOSE (o layout mudou?). Abortando — nada subiu."
    exit 1
  fi
  if ! docker stack deploy --with-registry-auth -c "$PG_COMPOSE" "$STACK"; then
    rm -f "$PG_COMPOSE"
    err "stack deploy do Postgres falhou. Abortando — nenhum serviço de app subiu."
    exit 1
  fi
  rm -f "$PG_COMPOSE"
  ok "Postgres do stack criado (api/workers/web/agent-runtime/landing ainda NÃO subiram)"
fi

# --- 4.1 Espera o Postgres ficar SAUDÁVEL ------------------------------------
# Olha o healthcheck do container (pg_isready), não só "Running": um Postgres
# recém-criado passa um tempo no initdb e o `docker service ps` já diz Running.
step "Aguardando Postgres ficar saudável"
PG_CONTAINER=""
pg_healthy=0
for i in $(seq 1 45); do
  PG_CONTAINER="$(docker ps --filter "label=com.docker.swarm.service.name=$PG_SERVICE" \
    --format '{{.Names}}' 2>/dev/null | head -1 || true)"
  if [ -n "$PG_CONTAINER" ]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
      "$PG_CONTAINER" 2>/dev/null || true)"
    if [ "$health" = "healthy" ]; then pg_healthy=1; break; fi
  fi
  if [ "$i" -lt 45 ]; then sleep 4; fi
done
if [ "$pg_healthy" -ne 1 ]; then
  err "Postgres ($PG_SERVICE) não ficou saudável em ~3 min — abortando ANTES de migrar e de subir código."
  err "Diagnóstico: docker service ps $PG_SERVICE --no-trunc  ·  docker service logs $PG_SERVICE"
  exit 1
fi
ok "Postgres saudável ($PG_CONTAINER)"

# --- 5. BACKUP PRÉ-MIGRATION (F57-S07) --------------------------------------
# Dados são sagrados. Migration é a única etapa do deploy que altera o banco de
# forma que `docker stack deploy` não desfaz: a imagem anterior volta com um
# rollback, o schema não. Este dump é o que separa "voltamos em 5 minutos" de
# "perdemos o histórico do cliente".
#
# FAIL-CLOSED: se o dump falhar, o deploy aborta ANTES de migrar.
#
# Única exceção: banco SEM NENHUMA tabela (primeira instalação, ou uma primeira
# instalação cuja migração falhou antes de criar tabela). Não há dado a proteger,
# e o dump de um banco vazio tem menos de 1 KB: cairia na trava de "dump suspeito"
# abaixo e travaria a instalação para sempre. A contagem vem do catálogo do
# próprio Postgres; se a consulta falhar, aborta (fail-closed também aqui).
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
RESTORE_CMD=""
step "Backup pré-migration ($BACKUP_DIR)"

USER_TABLES_SQL="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'"
if ! USER_TABLES="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "$USER_TABLES_SQL")"; then
  err "Não consegui consultar o banco antes do backup. Deploy abortado antes das migrations — nada foi alterado."
  exit 1
fi
USER_TABLES="$(printf '%s' "$USER_TABLES" | tr -d '[:space:]')"
case "$USER_TABLES" in
  '' | *[!0-9]*)
    err "Resposta inesperada ao contar as tabelas ('$USER_TABLES'). Deploy abortado antes das migrations."
    exit 1 ;;
esac

if [ "$USER_TABLES" -eq 0 ]; then
  c "1;33" "⚠ Banco '$PG_DB' sem nenhuma tabela (primeira instalação) — nada a proteger, backup pulado."
else
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/${STACK}-$(date -u +%Y%m%dT%H%M%SZ)-${APP_VERSION}.dump"
  # Formato custom (-Fc): comprimido e restaurável seletivamente por tabela.
  if ! docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$BACKUP_FILE"; then
    rm -f "$BACKUP_FILE"
    err "pg_dump FALHOU. Deploy abortado antes das migrations — nada foi alterado no banco."
    exit 1
  fi

  # Dump vazio é pior que dump nenhum: dá falsa segurança na hora do incidente.
  BACKUP_BYTES="$(wc -c < "$BACKUP_FILE")"
  if [ "$BACKUP_BYTES" -lt 1024 ]; then
    err "Dump saiu com apenas ${BACKUP_BYTES} bytes — suspeito. Deploy abortado antes das migrations."
    exit 1
  fi
  ok "Backup: $BACKUP_FILE ($(numfmt --to=iec "$BACKUP_BYTES" 2>/dev/null || echo "${BACKUP_BYTES}B"))"

  # A saída de restore fica IMPRESSA aqui de propósito: durante um incidente
  # ninguém quer procurar a sintaxe do pg_restore em runbook.
  RESTORE_CMD="docker exec -i $PG_CONTAINER pg_restore -U $PG_USER -d $PG_DB --clean --if-exists < $BACKUP_FILE"
  c "1;33" "  Restore:  $RESTORE_CMD"

  # Retenção: mantém os N mais recentes. Os nomes são gerados por este script
  # (sem espaço nem quebra de linha), então `ls -t` é seguro aqui.
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/"${STACK}"-*.dump 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old_dump; do
    rm -f "$old_dump" && c "0;90" "  poda: removido $(basename "$old_dump")"
  done
fi

# --- 6. Migrations com a imagem NOVA, ANTES do código novo subir -------------
# Container efêmero na rede interna do stack (attachable), com a imagem da api
# recém-construída. Até aqui o stack segue na versão anterior: se a migração
# falhar, NADA do código novo sobe.
step "Rodando migrations com leadium-api:$APP_VERSION (antes do stack deploy)"
mig_ok=0
for i in $(seq 1 6); do
  if docker run --rm \
      --network "$INTERNAL_NET" \
      -e DATABASE_URL="$DATABASE_URL" \
      "leadium-api:${APP_VERSION}" pnpm --filter @hm/db migrate; then
    mig_ok=1; break
  fi
  if [ "$i" -lt 6 ]; then
    c "1;33" "  migration tentativa $i falhou (Postgres ainda acordando? lock_timeout?), retry em 5s…"
    sleep 5
  fi
done
if [ "$mig_ok" -ne 1 ]; then
  err "Migrations FALHARAM (6 tentativas). Deploy abortado ANTES do stack deploy."
  err "Nada do código :$APP_VERSION subiu: os serviços seguem na versão anterior, contra o schema atual."
  err "1) Leia o erro acima (pré-voo da migration? lock_timeout? dado que viola uma constraint nova?)."
  err "2) Migrations são aditivas: o código anterior convive com o que tiver sido aplicado. Corrija e rode o deploy de novo."
  if [ -n "$RESTORE_CMD" ]; then
    err "3) Só se o banco ficou inconsistente (dado alterado ou perdido), restaure o backup deste deploy:"
    c "1;33" "     $RESTORE_CMD"
  else
    err "3) Primeira instalação: não há dado a restaurar. Só o Postgres está no ar; corrija e rode o deploy de novo."
  fi
  exit 1
fi
ok "Migrations aplicadas"

# --- 7. Deploy do stack (código novo contra o schema já migrado) -------------
step "Deploy do stack '$STACK'"
docker stack deploy --prune --with-registry-auth -c "$COMPOSE" "$STACK"
ok "Stack aplicado"

step "Status dos serviços"
docker stack services "$STACK"
echo

# --- 8. Verificação: cada serviço de app convergiu para o sha do deploy -------
# Um "Deploy concluído" verde NÃO garante que todo serviço subiu: com start-first,
# um serviço cujo healthcheck falha fica PAUSADO na imagem anterior (ex.: deploy
# 7637ccf, agent-runtime revertido silenciosamente). Aqui cruzamos a imagem da task
# RODANDO de cada serviço de app contra $APP_VERSION e falhamos ALTO se divergir —
# nunca mais um deploy "verde" com serviço para trás. Dá ~90s de folga p/ convergir.
step "Verificando sha deployado de cada serviço de app"
APP_SERVICES="api workers web agent-runtime landing"
verify_fail=1
mismatch=""
for _ in $(seq 1 18); do
  verify_fail=0; mismatch=""
  for s in $APP_SERVICES; do
    running=$(docker service ps "${STACK}_${s}" --filter desired-state=running \
      --format '{{.Image}}' 2>/dev/null | head -1)
    tag="${running##*:}"
    if [ "$tag" != "$APP_VERSION" ]; then
      verify_fail=1; mismatch="$mismatch ${s}:${tag:-none}"
    fi
  done
  [ "$verify_fail" -eq 0 ] && break
  sleep 5
done
if [ "$verify_fail" -ne 0 ]; then
  err "Serviços NÃO convergiram para :$APP_VERSION →$mismatch"
  err "Update provavelmente pausado (healthcheck/boot). Diagnóstico: docker service ps ${STACK}_<svc>"
  err "Correção manual: docker service update --image leadium-<svc>:$APP_VERSION --update-failure-action pause --force ${STACK}_<svc>"
  exit 1
fi
ok "Todos os serviços de app convergiram para :$APP_VERSION"

ok "Deploy concluído — https://app.leadium.com.br  ·  https://api.leadium.com.br"
