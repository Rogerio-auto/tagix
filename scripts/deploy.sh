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

# --- 3. Build das imagens no nó ----------------------------------------------
step "Buildando imagens (api, web, workers, agent-runtime, landing)"
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

# --- 6. Migrations (container efêmero na rede interna) -----------------------
step "Rodando migrations (drizzle: @hm/db migrate)"
mig_ok=0
for i in $(seq 1 6); do
  if docker run --rm \
      --network "$INTERNAL_NET" \
      -e DATABASE_URL="$DATABASE_URL" \
      leadium-api:latest pnpm --filter @hm/db migrate; then
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
ok "Deploy concluído — https://app.leadium.com.br  ·  https://api.leadium.com.br"
