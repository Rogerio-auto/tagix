# Runbook — Versionar e sincronizar o Claude Code (Windows, via GitHub)

> **Para quem:** Rogério, querendo **backup versionado** da config do Claude Code e a opção de reproduzir o mesmo ambiente em outra máquina Windows.
> **Estratégia:** repo Git privado `claude-config` no GitHub com **snapshot total** da configuração + script `bootstrap.ps1` que monta o `~/.claude/` em ~2 minutos.
> **Resultado:** mesmos slash commands (`/hm-init`, `/hm-engineer`, `/hm-designer`, `/hm-qa`, `/hm-deploy`, `/hm-security`, `/hm-tasks`, `/hm-adversarial`, `/hm-edge-cases`, `/hm-correct-course`, `/hm-retrospective`), mesmo CLAUDE.md global, mesmas permissões.

> **Nota:** no setup atual a config global já foi aplicada direto em `C:\Users\Ueverton\.claude\` (CLAUDE.md, settings.json, 11 skills). Este runbook é pra **versionar isso num repo** e ter backup/portabilidade — não é obrigatório pra trabalhar.

---

## 1. Como o Claude Code se configura (mapa do estado atual)

Tudo do Claude Code vive em `C:\Users\Ueverton\.claude\` (`~/.claude`):

```
~/.claude/
├── CLAUDE.md                        ✅ versiona (padrão global)
├── settings.json                    ✅ versiona (permissões, modelo, voz)
├── skills/                          ✅ versiona (as 11 hm-*)
│   ├── hm-init/   ├── hm-engineer/  ├── hm-designer/  ├── hm-qa/
│   ├── hm-deploy/ ├── hm-security/  ├── hm-tasks/     ├── hm-adversarial/
│   ├── hm-edge-cases/  ├── hm-correct-course/  └── hm-retrospective/
│
├── memory/                          ✅ versiona se quiser (aprendizados persistentes)
├── sessions/                        ❌ NUNCA versiona (privado, secrets em logs)
├── projects/                        ❌ NUNCA versiona (pesado)
├── history.jsonl                    ❌ NUNCA versiona
├── cache/ downloads/ backups/ ...   ❌ NUNCA versiona (estado/ephemeral)
└── .credentials.json                ❌ NUNCA versiona (token de login)
```

**Princípio:** versiona só **identidade e configuração** (CLAUDE.md, settings.json, skills). Tudo que é estado de sessão ou credencial fica de fora. O `.gitignore` do template já cobre isso.

---

## 2. Estratégia: snapshot total

As 11 skills `hm-*` ficam versionadas no seu repo como cópia (snapshot). **Zero dependência externa:** se o repo upstream `highermind-code-skills` sumir amanhã, seu setup continua funcionando.

Trade-off consciente: você não recebe updates automáticos do upstream — puxa à mão quando quiser (§7).

---

## 3. Estrutura do repo `claude-config`

Os arquivos prontos estão em `docs/runbooks/claude-config-template/` deste projeto, **já populados com o conteúdo real** do seu `~/.claude/`:

```
claude-config/                       (repo privado seu no GitHub)
├── CLAUDE.md
├── settings.json
├── skills/
│   ├── hm-init/  (+ templates/)
│   ├── hm-engineer/  hm-designer/  hm-qa/  hm-deploy/  hm-security/  hm-tasks/
│   └── hm-adversarial/  hm-edge-cases/  hm-correct-course/  hm-retrospective/
├── bootstrap.ps1                    (instala tudo numa máquina Windows)
├── update.ps1                       (sincroniza ~/.claude/ -> repo)
├── .gitignore
└── README.md
```

---

## 4. Criar o repo e popular (PowerShell)

### 4.1 Criar repo privado no GitHub

Abra https://github.com/new e crie `claude-config` como **privado**. Sem README, sem .gitignore, sem licença (vêm do template).

### 4.2 Clonar e popular

```powershell
PS> Set-Location "$env:USERPROFILE"
PS> git clone https://github.com/Rogerio-auto/claude-config.git
PS> Set-Location claude-config

# Copiar o template inteiro (já populado com seus arquivos reais):
PS> $template = "C:\Users\Ueverton\Desktop\Saas Tagix\docs\runbooks\claude-config-template"
PS> Copy-Item "$template\*" . -Recurse -Force

PS> git add .
PS> git commit -m "Initial snapshot of Claude Code config + 11 skills"
PS> git push -u origin main
```

Confira no GitHub que tem CLAUDE.md, settings.json, 11 pastas em `skills/`, e os scripts `.ps1`.

---

## 5. Restaurar numa máquina Windows nova

> Pré-requisitos: Git, Node ≥ 22, npm (veja `dev-environment-windows.md` §2–3).

```powershell
PS> Set-Location "$env:USERPROFILE"
PS> git clone https://github.com/Rogerio-auto/claude-config.git
PS> Set-Location claude-config
PS> ./bootstrap.ps1
```

O `bootstrap.ps1` executa:

1. Verifica Node ≥ 22 (avisa se faltar).
2. Instala o Claude Code CLI globalmente (`npm i -g @anthropic-ai/claude-code`) se não houver.
3. Cria `~/.claude/` e `~/.claude/skills/` se não existirem.
4. Faz backup do `CLAUDE.md`/`settings.json` atuais em `~/.claude/backups/manual/<timestamp>/`.
5. Copia `CLAUDE.md`, `settings.json` e todas as `skills/*` do repo pro `~/.claude/`.
6. Lista as skills instaladas.

> **Se a ExecutionPolicy bloquear o script:** rode `powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1` (bypass pontual, não muda a policy global).

---

## 6. Workflow contínuo

Quando editar uma skill ou o CLAUDE.md, sincronize de volta pro repo:

```powershell
PS> Set-Location "$env:USERPROFILE\claude-config"
PS> ./update.ps1 "ajustei o padrão de design"
```

Faz: copia `~/.claude/CLAUDE.md`, `settings.json` e cada skill versionada de volta pro repo, faz `git add + commit + push`.

Em outra máquina, a qualquer momento:

```powershell
PS> Set-Location "$env:USERPROFILE\claude-config"
PS> git pull
PS> ./bootstrap.ps1        # idempotente
```

---

## 7. Atualizar manualmente as skills do upstream (opcional)

```powershell
PS> git clone --depth 1 https://github.com/rodrigohighermind/highermind-code-skills.git "$env:TEMP\upstream"

# Comparar uma skill específica
PS> Compare-Object (Get-Content "$env:TEMP\upstream\hm-engineer\SKILL.md") (Get-Content ".\skills\hm-engineer\SKILL.md")

# Se gostar, sobrescreve e commita
PS> Copy-Item "$env:TEMP\upstream\hm-engineer\*" ".\skills\hm-engineer\" -Recurse -Force
PS> Remove-Item "$env:TEMP\upstream" -Recurse -Force
PS> ./update.ps1 "sync hm-engineer com upstream"
```

Não é automático de propósito. Você revisa antes de aceitar.

---

## 8. Onde guardar secrets (NÃO no repo)

| Estratégia | Quando usar |
|---|---|
| Variável de ambiente do Windows (`setx NOME valor`) | Tokens simples, 1–2 valores |
| `.env` em `~/.claude/.env` (já no `.gitignore`) | Vários secrets agrupados |
| 1Password CLI (`op read`) ou similar | Múltiplas máquinas com rotação |

---

## 9. Conferir que sincronizou direito

No Claude Code:

```
> Quais skills eu tenho disponíveis?
```

Deve listar as 11: `hm-init`, `hm-engineer`, `hm-designer`, `hm-qa`, `hm-deploy`, `hm-security`, `hm-tasks`, `hm-adversarial`, `hm-edge-cases`, `hm-correct-course`, `hm-retrospective`.

No PowerShell:

```powershell
PS> Get-ChildItem "$env:USERPROFILE\.claude\skills" -Directory | Select-Object Name
PS> Get-Content "$env:USERPROFILE\.claude\settings.json" | ConvertFrom-Json
```

---

## 10. Troubleshooting

### `claude: command not found` na máquina nova

→ O bin global do npm não está no PATH. Veja onde fica e adicione:
```powershell
PS> npm config get prefix         # ex.: C:\Users\Ueverton\AppData\Roaming\npm
PS> $env:Path -split ';' | Select-String npm
```
Se não aparecer, adicione `…\AppData\Roaming\npm` ao PATH (Configurações → Variáveis de ambiente) e reabra o terminal.

### `bootstrap.ps1` não executa (ExecutionPolicy)

→ `powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1`.

### Skills sumiram depois de um `git clean`

→ Você apagou `~/.claude/skills/`. Recupere:
```powershell
PS> Set-Location "$env:USERPROFILE\claude-config"; ./bootstrap.ps1
```

### Edição local sobrescrita pelo bootstrap

→ O bootstrap sobrescreve com o conteúdo do repo. Sempre rode `./update.ps1` **antes** de `git pull` em outra máquina, pra não perder edição local não-commitada.

---

## 11. Apêndice: por que não versionar `sessions/`, `history.jsonl`, etc.

- **`sessions/`**: cada turno de conversa em JSON; pode conter código privado e tokens em logs. Privado.
- **`history.jsonl`**: histórico de prompts. Privado.
- **`projects/`**: snapshots por projeto. Pesado (GB rápido). O estado real está nos repos dos projetos.
- **`cache/`, `downloads/`, `shell-snapshots/`**: ephemeral, regerado a cada sessão.
- **`.credentials.json`**: seu token de login. Nunca commitar.

Versionar isso = repo gigante, lento, com PII e secrets. O `.gitignore` do template cobre tudo. Mantenha.

---

> Runbook mantido por: Rogério. Adicionou uma skill nova? Copie pra `skills/<nome>/` no repo, rode `./update.ps1`, e o bootstrap pega automaticamente.
