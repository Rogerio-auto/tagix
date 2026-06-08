# Runbook — Sincronizar Claude Code entre máquinas (via GitHub)

> **Para quem:** Rogério migrando para PC novo (Linux/WSL2). Quer a mesma performance e as mesmas skills do Claude Code do PC atual.
> **Estratégia:** repo Git privado `claude-config` no GitHub com **snapshot total** da configuração + script `bootstrap.sh` que monta o `~/.claude/` no PC novo em ~2 minutos.
> **Resultado:** mesmos 7 slash commands (`/hm-init`, `/hm-engineer`, `/hm-designer`, `/hm-qa`, `/hm-deploy`, `/hm-security`, `/hm-tasks`), mesmo CLAUDE.md global, mesmas permissões. Zero dependência de repos externos.

---

## 1. Como Claude Code se configura (mapa do estado atual)

Tudo do Claude Code vive em `~/.claude/`. Sua máquina hoje tem:

```
~/.claude/
├── CLAUDE.md                        ✅ versiona (seu padrão global)
├── settings.json                    ✅ versiona (permissões, modelo, perms VPS)
├── skills/
│   ├── highermind-code-skills/      ⚠ pacote upstream — vamos snapshotar o conteúdo
│   │   ├── hm-init/                 ✅ snapshot pro seu repo
│   │   ├── hm-engineer/             ✅ snapshot pro seu repo
│   │   ├── hm-designer/             ✅ snapshot pro seu repo
│   │   ├── hm-qa/                   ✅ snapshot pro seu repo
│   │   ├── hm-deploy/               ✅ snapshot pro seu repo
│   │   ├── hm-security/             ✅ snapshot pro seu repo
│   │   └── setup                    (script de symlinks; não precisa no novo modelo)
│   ├── hm-init/                     (cópia/symlink que o setup criou — bootstrap regenera)
│   ├── hm-engineer/                 (idem)
│   ├── ... (idem para as 6 do upstream)
│   └── hm-tasks/                    ✅ versiona (skill sua, fora do upstream)
│       └── SKILL.md
│
├── sessions/                        ❌ NUNCA versiona (privado, secrets em logs)
├── projects/                        ❌ NUNCA versiona (pesado)
├── history.jsonl                    ❌ NUNCA versiona
├── cache/                           ❌ NUNCA versiona
├── backups/                         ❌ NUNCA versiona
└── ...demais pastas de estado       ❌ NUNCA versiona
```

**Princípio:** versiona só **identidade e configuração** (CLAUDE.md, settings.json, skills). Tudo que é estado de sessão fica de fora.

---

## 2. Decisão: snapshot total vs link com upstream

Existem dois jeitos de tratar as 6 skills do Rodrigo (`hm-init`, `hm-engineer`, `hm-designer`, `hm-qa`, `hm-deploy`, `hm-security`):

| Estratégia | Vantagem | Desvantagem |
|---|---|---|
| **Snapshot total (adotado)** | Tudo num lugar, zero dependência externa, bootstrap em 2 minutos. Se o upstream sumir/quebrar, você está coberto. | Não recebe updates automáticos do mantenedor. Precisa puxar mudanças à mão de vez em quando. |
| Link com upstream | Recebe updates do Rodrigo via `git pull` no `bootstrap.sh`. | Depende do repo dele existir e estar acessível. Setup mais complexo. |

**Escolha:** snapshot total. As skills do Rodrigo são estáveis (não mudam toda semana), e o ganho de simplicidade compensa o trabalho de atualizar manualmente quando você quiser.

---

## 3. Estrutura do repo `claude-config`

```
claude-config/                       (repo privado seu no GitHub)
├── CLAUDE.md                        (cópia do seu ~/.claude/CLAUDE.md)
├── settings.json                    (cópia do seu ~/.claude/settings.json)
├── skills/
│   ├── hm-init/                     (snapshot upstream)
│   │   ├── SKILL.md
│   │   └── templates/
│   ├── hm-engineer/                 (snapshot upstream)
│   │   └── SKILL.md
│   ├── hm-designer/                 (snapshot upstream)
│   │   └── SKILL.md
│   ├── hm-qa/                       (snapshot upstream)
│   │   └── SKILL.md
│   ├── hm-deploy/                   (snapshot upstream)
│   │   └── SKILL.md
│   ├── hm-security/                 (snapshot upstream)
│   │   └── SKILL.md
│   └── hm-tasks/                    (sua)
│       └── SKILL.md
├── bootstrap.sh                     (instala tudo no PC novo)
├── update.sh                        (sincroniza ~/.claude/ → repo)
├── .gitignore
└── README.md
```

Arquivos prontos em `docs/runbooks/claude-config-template/` deste projeto, **já populados com conteúdo real** do seu `~/.claude/`. É só copiar pro repo novo e comitar.

---

## 4. Criar o repo no PC atual (Windows com Git Bash)

### 4.1 Criar repo privado no GitHub

Abra https://github.com/new e crie `claude-config` como **privado**. Sem README, sem .gitignore, sem licença (vêm do template).

### 4.2 Clonar e popular

```bash
# Em qualquer terminal (Git Bash, PowerShell com Git, ou WSL):
cd ~/Desktop
git clone git@github.com:<seu-usuario>/claude-config.git
cd claude-config

# Copiar o template inteiro (já populado com seus arquivos reais):
TEMPLATE="/c/Users/roger/Desktop/Rogerio/Pessoal/Aprendizado/highermind-v2/docs/runbooks/claude-config-template"
cp -r "$TEMPLATE"/. .

# Tornar scripts executáveis (importante pra Linux)
chmod +x bootstrap.sh update.sh

git add .
git commit -m "Initial snapshot of Claude Code config + 7 skills"
git push -u origin main
```

Repo populado. Confira no GitHub que tem CLAUDE.md, settings.json, 7 pastas em skills/, e os scripts.

---

## 5. Restaurar no PC novo (Linux/WSL2)

> Pré-requisitos: §3 do runbook `dev-environment-wsl2.md` rodado (Ubuntu 24.04 instalado, Git configurado, Node 22 + npm).

```bash
# 1. Clonar seu repo de config
cd ~
git clone git@github.com:<seu-usuario>/claude-config.git
cd claude-config

# 2. Rodar o bootstrap
./bootstrap.sh
```

O `bootstrap.sh` executa:

1. Verifica Node ≥ 22 (avisa se faltar).
2. Instala Claude Code CLI globalmente (`npm i -g @anthropic-ai/claude-code`).
3. Cria `~/.claude/` e `~/.claude/skills/` se não existirem.
4. Faz backup do `~/.claude/CLAUDE.md` e `settings.json` atuais (se houver) em `~/.claude/backups/manual/<timestamp>/`.
5. Copia `CLAUDE.md`, `settings.json`, todas as `skills/*` do repo pra `~/.claude/`.
6. Lista as skills instaladas pra confirmar.

Tempo total: ~2 minutos. No fim, mostra:

```
═══════════════════════════════════════════════════════════════
  Bootstrap completo
═══════════════════════════════════════════════════════════════

  Claude Code CLI:    1.x.x
  CLAUDE.md:          /home/roger/.claude/CLAUDE.md
  settings.json:      /home/roger/.claude/settings.json
  Skills em:          /home/roger/.claude/skills

  Skills disponíveis:
    /hm-deploy
    /hm-designer
    /hm-engineer
    /hm-init
    /hm-qa
    /hm-security
    /hm-tasks

  Abra um terminal novo e digite 'claude' pra começar.
```

---

## 6. Workflow contínuo: mantendo as duas máquinas em sync

Quando você editar uma skill ou seu CLAUDE.md numa máquina, sincronize:

```bash
cd ~/claude-config
./update.sh "ajustei o padrão de design"
```

Faz: copia `~/.claude/CLAUDE.md`, `settings.json` e cada skill versionada de volta pro repo, faz `git add + commit + push`.

Na outra máquina, em qualquer momento:

```bash
cd ~/claude-config
git pull
./bootstrap.sh        # idempotente
```

---

## 7. Atualizar manualmente as skills do Rodrigo (opcional)

Periodicamente, se quiser puxar mudanças que o Rodrigo lançar no `highermind-code-skills`:

```bash
# Clone temporário do upstream
git clone --depth 1 https://github.com/rodrigohighermind/highermind-code-skills.git /tmp/upstream

# Diff visual de uma skill específica
diff -r /tmp/upstream/hm-engineer ~/claude-config/skills/hm-engineer

# Se gostar do que viu, sobrescreve
cp -r /tmp/upstream/hm-engineer/. ~/claude-config/skills/hm-engineer/

# Limpa
rm -rf /tmp/upstream

# Comita
cd ~/claude-config
./update.sh "sync hm-engineer com upstream"
```

Não é automático de propósito. Você revisa antes de aceitar.

---

## 8. Onde guardar secrets (NÃO no repo)

| Estratégia | Quando usar |
|---|---|
| Variável de ambiente (`~/.bashrc` ou `~/.zshrc`) | Tokens simples, 1–2 valores |
| `.env` em `~/.claude/.env` (já no `.gitignore`) | Vários secrets agrupados |
| 1Password CLI (`op read`) ou similar | Equipe / múltiplas máquinas com rotação |

---

## 9. Como conferir que sincronizou direito

No PC novo, depois do bootstrap, no Claude Code:

```
> Quais skills eu tenho disponíveis?
```

Deve listar 7: `hm-init`, `hm-engineer`, `hm-designer`, `hm-qa`, `hm-deploy`, `hm-security`, `hm-tasks`.

Também rode:

```bash
ls -la ~/.claude/skills/
cat ~/.claude/CLAUDE.md | head -10
cat ~/.claude/settings.json | python3 -m json.tool
```

---

## 10. Troubleshooting

### `claude: command not found` no PC novo

→ npm global bin não está no PATH. Verifique:
```bash
npm config get prefix     # geralmente /usr/local ou ~/.local
echo $PATH | grep -q "$(npm config get prefix)/bin" || \
  echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
```

### Bootstrap rodou mas Claude não vê as skills

→ Confira `ls ~/.claude/skills/` — tem que ter as 7 pastas. Se vazio, alguma permissão impediu a cópia. Rode o bootstrap com `bash -x ./bootstrap.sh` pra ver linha a linha.

### CLAUDE.md ficou em duplicata depois de bootstrap rodado 2x

→ O bootstrap é idempotente, sobrescreve. Mas se você editar manualmente sem usar `./update.sh`, a próxima `./bootstrap.sh` sobrescreve sua edição local. Sempre rode `./update.sh` antes de `git pull` em outra máquina.

### `permission denied` ao rodar `bootstrap.sh`

→ Sem permissão de execução. Rode:
```bash
chmod +x ~/claude-config/bootstrap.sh ~/claude-config/update.sh
```

### Skills sumiram depois de `git clean`

→ Você apagou `~/.claude/skills/`. Recupere:
```bash
cd ~/claude-config && ./bootstrap.sh
```

---

## 11. Apêndice: por que não versionar `sessions/`, `history.jsonl`, etc.

- **`sessions/`**: cada turno de conversa salvo em JSON, pode conter trechos de código privado, tokens em logs, prompts internos. Privado.
- **`history.jsonl`**: histórico de prompts. Privado.
- **`projects/`**: snapshots por projeto. Pesado (GB rapidamente). Não traz benefício no PC novo — o estado real está nos repos dos projetos em si.
- **`cache/`, `downloads/`, `shell-snapshots/`**: ephemeral. Gerado novo a cada sessão.

Versionar isso = repo gigante, lento, com PII e secrets espalhados. **Não faça.**

O `.gitignore` do template já cobre tudo isso. Mantenha.

---

> Runbook mantido por: Rogério. Se adicionar uma skill nova, basta copiar pra `skills/<nome>/` no repo, comitar e o bootstrap pega automaticamente.
