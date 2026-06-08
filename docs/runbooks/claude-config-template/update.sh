#!/usr/bin/env bash
# update.sh — sincroniza ~/.claude/ local → repo (e faz commit/push)
# Uso: ./update.sh ["mensagem opcional do commit"]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${HOME}/.claude"

if [[ -t 1 ]]; then
  GRN='\033[0;32m'; YLW='\033[1;33m'; NC='\033[0m'
else
  GRN=''; YLW=''; NC=''
fi
ok()   { echo -e "${GRN}✓${NC} $*"; }
warn() { echo -e "${YLW}⚠${NC} $*"; }

# CLAUDE.md
if [[ -f "${CLAUDE_HOME}/CLAUDE.md" ]]; then
  cp "${CLAUDE_HOME}/CLAUDE.md" "${REPO_DIR}/CLAUDE.md"
  ok "CLAUDE.md copiado"
fi

# settings.json
if [[ -f "${CLAUDE_HOME}/settings.json" ]]; then
  cp "${CLAUDE_HOME}/settings.json" "${REPO_DIR}/settings.json"
  ok "settings.json copiado"
fi

# Skills personalizadas
# (apenas as que já existem no repo — não pega todas de ~/.claude/skills/ pra não trazer upstream)
if [[ -d "${REPO_DIR}/skills" ]]; then
  for item in "${REPO_DIR}/skills"/*; do
    [[ -e "${item}" ]] || continue
    name="$(basename "${item}")"
    src="${CLAUDE_HOME}/skills/${name}"

    if [[ -d "${src}" ]] && [[ -d "${item}" ]]; then
      rm -rf "${item}"
      cp -r "${src}" "${item}"
      ok "skill: ${name}/"
    elif [[ -f "${src}" ]] && [[ -f "${item}" ]]; then
      cp "${src}" "${item}"
      ok "skill: ${name}"
    else
      warn "skill ${name}: estrutura mudou no ~/.claude/, verifique manualmente"
    fi
  done
fi

# Git commit + push
cd "${REPO_DIR}"

if [[ -n "$(git status --porcelain)" ]]; then
  MSG="${1:-sync from $(hostname) on $(date +%Y-%m-%d)}"
  git add -A
  git commit -m "${MSG}"
  git push
  ok "Push concluído: ${MSG}"
else
  ok "Nada mudou — repo já está em dia"
fi
