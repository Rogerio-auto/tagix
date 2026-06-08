# claude-config

Minha configuração pessoal do **Claude Code**: CLAUDE.md global, settings.json e **todas as skills** (snapshot). Clonável em qualquer PC (Linux, macOS, WSL2) pra reproduzir o mesmo ambiente em ~2 minutos.

## O que tem aqui

- `CLAUDE.md` — meu padrão global (identidade, stack, padrão world-class)
- `settings.json` — permissões, modelo default, allow/deny rules
**Execução (do upstream `highermind-code-skills` + suas):**
- `skills/hm-init/` — começar projeto novo
- `skills/hm-engineer/` — validar código em todas as camadas
- `skills/hm-designer/` — validar interface
- `skills/hm-qa/` — testar tudo
- `skills/hm-deploy/` — validar deploy e infra
- `skills/hm-security/` — auditoria de segurança
- `skills/hm-tasks/` — decompor feature em slots executáveis

**Revisão e governança (adaptadas do BMAD-METHOD ao estilo Higher Mind):**
- `skills/hm-adversarial/` — revisão adversarial (tenta quebrar de propósito)
- `skills/hm-edge-cases/` — caçador de edge cases (varrer mecânico)
- `skills/hm-correct-course/` — diagnóstico de desvio de plano + propostas
- `skills/hm-retrospective/` — extrai aprendizado de slot/fase pra memória persistente
- `bootstrap.sh` — instala/atualiza tudo no PC novo
- `update.sh` — sincroniza `~/.claude/` local → este repo

## Estratégia: snapshot total

Tudo que define meu ambiente Claude Code está versionado aqui. **Zero dependência externa.** Se o GitHub original do `highermind-code-skills` desaparecer amanhã, meu setup continua funcionando — eu tenho o snapshot.

Trade-off consciente: não recebo updates automáticos do upstream. Pra atualizar manualmente quando quiser:

```bash
# clone temporário do upstream
git clone https://github.com/rodrigohighermind/highermind-code-skills.git /tmp/upstream
# inspeciona diff, decide se quero
diff -r /tmp/upstream/hm-engineer ./skills/hm-engineer
# se quiser, copia
cp -r /tmp/upstream/hm-engineer/* ./skills/hm-engineer/
./update.sh "sync hm-engineer com upstream YYYY-MM-DD"
```

## O que **NÃO** tem aqui (e por quê)

- `sessions/`, `history.jsonl`, `projects/`, `cache/`, etc. — estado de sessão; privado e pesado. `.gitignore` cobre.
- Tokens / API keys — ficam em variáveis de ambiente ou em `~/.claude/.env` (não-versionado).

## Primeira instalação num PC novo

Pré-requisitos: Git, Node ≥ 22, npm.

```bash
git clone git@github.com:<seu-usuario>/claude-config.git ~/claude-config
cd ~/claude-config
./bootstrap.sh
```

Tempo: ~2 minutos. No fim, lista as 7 skills instaladas.

## Atualizar depois de mexer no CLAUDE.md ou numa skill

```bash
cd ~/claude-config
./update.sh "ajuste no padrão de design"
```

Faz cópia, commit, push.

Na outra máquina:

```bash
cd ~/claude-config
git pull
./bootstrap.sh   # idempotente
```

## Adicionar uma skill nova

1. Criar a skill em `~/.claude/skills/<nome>/SKILL.md` (ou `~/.claude/skills/<nome>.md`).
2. Criar a mesma estrutura em `~/claude-config/skills/<nome>/SKILL.md`.
3. `./update.sh "add skill <nome>"`.

O `bootstrap.sh` já itera sobre todo conteúdo de `skills/`, então não precisa editar nada nele.

---

> Pessoal. Privado. Não compartilhar sem revisar `settings.json` (pode ter perms de VPS específicas).
