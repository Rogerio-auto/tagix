#!/usr/bin/env bash
# bootstrap.sh — instala/atualiza Claude Code + skills num PC novo
# Uso: ./bootstrap.sh
# Idempotente: pode rodar várias vezes sem efeito colateral.

set -euo pipefail

# ─── cores ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
else
  RED=''; GRN=''; YLW=''; BLU=''; NC=''
fi

info()  { echo -e "${BLU}ℹ${NC} $*"; }
ok()    { echo -e "${GRN}✓${NC} $*"; }
warn()  { echo -e "${YLW}⚠${NC} $*"; }
die()   { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ─── paths ────────────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_HOME}/skills"
BACKUP_DIR="${CLAUDE_HOME}/backups/manual/$(date +%Y%m%d-%H%M%S)"

# ─── pré-requisitos ───────────────────────────────────────────────────────────
info "Verificando pré-requisitos..."

command -v node >/dev/null || die "node não instalado. Veja runbook dev-environment-wsl2.md §5"
command -v npm >/dev/null  || die "npm não instalado."

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  warn "Node ${NODE_MAJOR} detectado — recomendado ≥ 22. Continuando, mas pode falhar."
fi

ok "Pré-requisitos OK"

# ─── Claude Code CLI ──────────────────────────────────────────────────────────
info "Verificando Claude Code CLI..."

if command -v claude >/dev/null; then
  CURRENT="$(claude --version 2>/dev/null | head -1 || echo unknown)"
  ok "Claude Code já instalado: ${CURRENT}"
else
  info "Instalando Claude Code CLI globalmente..."
  npm install -g @anthropic-ai/claude-code
  ok "Claude Code instalado: $(claude --version 2>/dev/null | head -1)"
fi

# ─── ~/.claude/ ───────────────────────────────────────────────────────────────
info "Preparando ${CLAUDE_HOME}..."

mkdir -p "${CLAUDE_HOME}" "${SKILLS_DIR}"

# Backup do que vai ser sobrescrito (idempotente, mas seguro)
if [[ -f "${CLAUDE_HOME}/CLAUDE.md" ]] || [[ -f "${CLAUDE_HOME}/settings.json" ]]; then
  mkdir -p "${BACKUP_DIR}"
  [[ -f "${CLAUDE_HOME}/CLAUDE.md" ]]     && cp "${CLAUDE_HOME}/CLAUDE.md" "${BACKUP_DIR}/"
  [[ -f "${CLAUDE_HOME}/settings.json" ]] && cp "${CLAUDE_HOME}/settings.json" "${BACKUP_DIR}/"
  info "Backup do estado atual: ${BACKUP_DIR}"
fi

# ─── CLAUDE.md global ─────────────────────────────────────────────────────────
if [[ -f "${REPO_DIR}/CLAUDE.md" ]]; then
  cp "${REPO_DIR}/CLAUDE.md" "${CLAUDE_HOME}/CLAUDE.md"
  ok "CLAUDE.md sincronizado"
else
  warn "CLAUDE.md não encontrado no repo — pulando"
fi

# ─── settings.json ────────────────────────────────────────────────────────────
if [[ -f "${REPO_DIR}/settings.json" ]]; then
  cp "${REPO_DIR}/settings.json" "${CLAUDE_HOME}/settings.json"
  ok "settings.json sincronizado"
else
  warn "settings.json não encontrado no repo — pulando"
fi

# ─── Skills (todas: hm-init, hm-engineer, hm-designer, hm-qa, hm-deploy, hm-security, hm-tasks) ──
info "Copiando skills..."

if [[ -d "${REPO_DIR}/skills" ]]; then
  for item in "${REPO_DIR}/skills"/*; do
    [[ -e "${item}" ]] || continue
    name="$(basename "${item}")"
    target="${SKILLS_DIR}/${name}"

    if [[ -d "${item}" ]]; then
      # skill folder-based (todas as hm-* atualmente)
      rm -rf "${target}"
      mkdir -p "${target}"
      cp -r "${item}/." "${target}/"
      ok "  skill: /${name}"
    elif [[ -f "${item}" ]]; then
      # skill file-based (caso adicione algum no futuro)
      cp "${item}" "${target}"
      ok "  skill: /${name%.md}"
    fi
  done
else
  warn "Pasta skills/ não encontrada no repo — pulando"
fi

# ─── Resumo final ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Bootstrap completo"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Claude Code CLI:    $(claude --version 2>/dev/null | head -1 || echo desconhecido)"
echo "  CLAUDE.md:          ${CLAUDE_HOME}/CLAUDE.md"
echo "  settings.json:      ${CLAUDE_HOME}/settings.json"
echo "  Skills em:          ${SKILLS_DIR}"
echo ""
echo "  Skills disponíveis:"
for skill_dir in "${SKILLS_DIR}"/*/; do
  [[ -d "${skill_dir}" ]] || continue
  name="$(basename "${skill_dir}")"
  echo "    /${name}"
done
for skill_file in "${SKILLS_DIR}"/*.md; do
  [[ -f "${skill_file}" ]] || continue
  name="$(basename "${skill_file}" .md)"
  echo "    /${name}"
done
echo ""
echo "  Abra um terminal novo e digite 'claude' pra começar."
echo ""
