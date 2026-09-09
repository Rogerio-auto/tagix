#!/usr/bin/env bash
# =============================================================================
# Leadium — deploy de produção (roda NO SERVIDOR, Ubuntu/Swarm).
#
#   sudo bash /opt/leadium/scripts/deploy.sh [branch]
#
# Faz: git pull -> build das imagens no nó -> docker stack deploy -> migrations.
# Idempotente: rodar de novo só aplica o que mudou. NÃO toca em stacks de terceiros
# (postgres/n8n/redis externos) — a Leadium tem infra própria isolada.
# Pré-requisitos: Swarm ativo, rede `network_public`, /opt/leadium/.env preenchido.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/leadium"
STACK="leadium"
COMPOSE="$APP_DIR/infra/docker/docker-compose.prod.yml"
BRANCH="${1:-main}"
INTERNAL_NET="${STACK}_leadium_internal"

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
  git reset --hard "origin/$BRANCH"
  ok "Código em $(git rev-parse --short HEAD)"
else
  c "1;33" "⚠ $APP_DIR não é um repositório git — pulando git pull (deploy do estado atual)."
fi

# --- 2. Carrega .env p/ interpolação do compose ------------------------------
set -a; . "$APP_DIR/.env"; set +a
export DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@postgres:5432/${PG_DB}"
# Tag das imagens pelo commit atual. CRÍTICO no Swarm: com tag fixa (:latest) o
# `stack deploy` NÃO recria os serviços (compara a string da tag, não o conteúdo),
# então mudanças de código não subiriam. Tag por sha => cada deploy é detectado.
export APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo latest)"
ok "Versão do deploy: $APP_VERSION"

# --- 3. Build das imagens no nó ----------------------------------------------
step "Buildando imagens (api, web, workers, agent-runtime, landing) :$APP_VERSION"
docker compose --env-file "$APP_DIR/.env" -f "$COMPOSE" build
ok "Imagens construídas"

# --- 4. Deploy do stack ------------------------------------------------------
step "Deploy do stack '$STACK'"
docker stack deploy --prune --with-registry-auth -c "$COMPOSE" "$STACK"
ok "Stack aplicado"

# --- 5. Espera o Postgres ficar pronto ---------------------------------------
step "Aguardando Postgres ficar saudável"
for i in $(seq 1 30); do
  state=$(docker service ps --format '{{.CurrentState}}' "${STACK}_postgres" 2>/dev/null | head -1 || true)
  case "$state" in
    Running*) ok "Postgres rodando"; break ;;
  esac
  [ "$i" -eq 30 ] && { err "Postgres não subiu a tempo."; exit 1; }
  sleep 4
done

# --- 5.5 BACKUP PRÉ-MIGRATION (F57-S07) --------------------------------------
# Dados são sagrados. Migration é a única etapa do deploy que altera o banco de
# forma que `docker stack deploy` não desfaz: a imagem anterior volta com um
# rollback, o schema não. Este dump é o que separa "voltamos em 5 minutos" de
# "perdemos o histórico do cliente".
#
# FAIL-CLOSED: se o dump falhar, o deploy aborta ANTES de migrar.
BACKUP_DIR="${BACKUP_DIR:-/opt/leadium/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
step "Backup pré-migration ($BACKUP_DIR)"

mkdir -p "$BACKUP_DIR"
PG_CONTAINER="$(docker ps --format '{{.Names}}' | grep "^${STACK}_postgres" | head -1 || true)"
[ -n "$PG_CONTAINER" ] || { err "Container do Postgres não encontrado — abortando ANTES de migrar."; exit 1; }

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
c "1;33" "  Restore:  docker exec -i $PG_CONTAINER pg_restore -U $PG_USER -d $PG_DB --clean --if-exists < $BACKUP_FILE"

# Retenção: mantém os N mais recentes.
ls -1t "$BACKUP_DIR"/${STACK}-*.dump 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old_dump; do
  rm -f "$old_dump" && c "0;90" "  poda: removido $(basename "$old_dump")"
done

# --- 6. Migrations (container efêmero na rede interna) -----------------------
step "Rodando migrations (drizzle: @hm/db migrate)"
mig_ok=0
for i in $(seq 1 6); do
  if docker run --rm \
      --network "$INTERNAL_NET" \
      -e DATABASE_URL="$DATABASE_URL" \
      "leadium-api:${APP_VERSION}" pnpm --filter @hm/db migrate; then
    mig_ok=1; break
  fi
  c "1;33" "  migration tentativa $i falhou (Postgres ainda acordando?), retry em 5s…"
  sleep 5
done
[ "$mig_ok" -eq 1 ] || { err "Migrations falharam."; exit 1; }
ok "Migrations aplicadas"

# --- 7. Status final ---------------------------------------------------------
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
