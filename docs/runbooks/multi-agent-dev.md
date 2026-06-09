# Runbook — Desenvolvimento multi-agente com Claude Code (Windows)

> **Para quem:** Rogério acelerando o desenvolvimento do `tagix` (Highermind v2) com 3–4 agentes Claude em paralelo, sem race conditions, conflitos de merge ou pisadas de pé.
> **Arquitetura:** 1 agente Claude **orchestrator** num painel dedicado + 3–4 agentes Claude **worker** em painéis separados, cada um num **Git worktree próprio**, isolados via **slots com `files_allowed`** (contrato de fronteira).
> **Resultado:** features avançam 3–4× mais rápido com qualidade preservada, porque cada worker tem escopo travado e não pode tocar arquivos de outro.

---

## 1. O problema que estamos resolvendo

Rodar 4 agentes Claude no mesmo repo, soltos, acaba assim:

- **Conflito silencioso:** agente A editou `packages/db/schema/agents.ts`, agente B editou o mesmo arquivo, último commit ganha; trabalho perdido.
- **Race em DB/migrations:** dois agentes geram migrations sequenciais com mesmo número (`0017_*` colidindo).
- **Repetição de trabalho:** agente A implementa helper que agente B também faz, em paralelo, sem saber.
- **Contexto explodindo:** orchestrator humano tenta lembrar o que cada agente está fazendo.

A solução tem três pilares:

| Pilar | Como funciona | O que evita |
|---|---|---|
| **Slots com `files_allowed`** | Cada slot declara explicitamente quais arquivos pode tocar. `slot.py plan-batch` rejeita slots com overlap. | Conflito de merge, sobrescrita silenciosa |
| **Git worktrees** | Cada agente trabalha num diretório paralelo do mesmo repo, com sua branch isolada. Filesystem isolado, objetos Git compartilhados. | Race em `git status`, builds simultâneos quebrados |
| **Orchestrator Claude dedicado** | 1 agente Claude principal num painel que decompõe, despacha, monitora. Nunca implementa código direto. | Você (humano) virar gargalo de coordenação |

---

## 2. Arquitetura

```
                          ┌───────────────────────────────────────┐
                          │       VOCÊ (Rogério)                  │
                          │   Conversa em alto nível com           │
                          │   o orchestrator. Aprova PRs.          │
                          └───────────────┬───────────────────────┘
                                          │
                                          ▼
        Painel 0 (Windows Terminal — sempre aberto)
        ┌────────────────────────────────────────────────────────┐
        │  claude  (modo orchestrator)                            │
        │  Skills: /hm-tasks, /hm-engineer, /hm-qa, ...           │
        │  Função: decompor features, despachar workers,          │
        │          monitorar STATUS.md, revisar PRs.              │
        │  NÃO escreve código direto.                             │
        └────────┬───────────────────────────────────────────────┘
                 │  você cola o prompt em cada painel de worker
                 │
        ┌────────┴──────────────────┬──────────────────┬──────────────────┐
        ▼                           ▼                  ▼                  ▼
  Painel 1                   Painel 2           Painel 3           Painel 4
  ┌──────────────┐          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ worktree-1   │          │ worktree-2   │   │ worktree-3   │   │ worktree-4   │
  │ slot F2-S04  │          │ slot F2-S05  │   │ slot F2-S06  │   │ (livre)      │
  │ branch:      │          │ branch:      │   │ branch:      │   │              │
  │ slot/F2-S04  │          │ slot/F2-S05  │   │ slot/F2-S06  │   │              │
  │ claude       │          │ claude       │   │ claude       │   │ (esperando)  │
  └──────────────┘          └──────────────┘   └──────────────┘   └──────────────┘
        │                           │                  │                  │
        └───────────────────────────┴──────────────────┴──────────────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │  Repo tagix          │
                          │  tasks/STATUS.md    ← autoritativo: quem faz o quê
                          │  tasks/COMMS.md     ← log compartilhado (append-only)
                          │  tasks/slots/F*/    ← slot files com frontmatter
                          │  scripts/slot.py    ← validation + plan-batch
                          │  .git/              ← objetos compartilhados
                          └─────────────────────┘
```

Pontos importantes:

1. **Um repo, vários worktrees.** `git worktree add ..\tagix-w2 main` cria um diretório irmão completo, com sua própria working copy, mas compartilhando os objetos Git do repo principal. Não duplica histórico no disco.
2. **Sessões Claude isoladas, contexto base compartilhado.** Cada `claude` num painel é uma sessão independente (não enxerga as conversas dos outros). MAS todos leem o mesmo `~/.claude/CLAUDE.md` global e a mesma `~/.claude/memory/` — então identidade e regras são uniformes.
3. **Comunicação via filesystem + Git.** Não tem socket nem broker. Cada agente lê `tasks/STATUS.md`, atualiza o frontmatter do próprio slot, faz commits. Orchestrator monitora.

---

## 3. Pré-requisitos

### 3.1 Skills já instaladas

Você já tem (vide `claude-code-sync.md`): `/hm-tasks`, `/hm-engineer`, `/hm-qa`, `/hm-security`. Estes são os papéis dos workers.

### 3.2 Sistema `tasks/` no projeto

O `/hm-init` (passo 10) instala isto no repo:

```
tagix/
├── tasks/
│   ├── PROTOCOL.md          # contrato lido por todo agente: como pegar slot, abrir branch, commitar
│   ├── STATUS.md            # gerado por slot.py sync — quem está fazendo o quê
│   ├── COMMS.md             # log append-only de mensagens entre agentes
│   ├── _TEMPLATE.md         # template de slot
│   └── slots/F0/ F1/ F2/ ...
└── scripts/
    └── slot.py              # CLI: status, plan-batch, validate, sync, claim, release
```

Se ainda não tem, rode `/hm-init` no projeto e o passo 10 cria.

### 3.3 Windows Terminal

Já vem no Windows 11. É onde você abre abas e divide painéis (um por agente):

- `Ctrl+Shift+T` — nova aba
- `Alt+Shift+D` — dividir painel automaticamente
- `Alt+Shift+-` / `Alt+Shift++` — dividir na horizontal / vertical
- `Alt+Setas` — mover o foco entre painéis
- `Ctrl+Shift+W` — fechar painel

Alternativa: **VS Code** com terminais split (`Ctrl+Shift+5`).

### 3.4 Hardware mínimo recomendado

Pra 3–4 workers simultâneos:

| Recurso | Mínimo confortável |
|---|---|
| RAM | 32 GB (cada `claude` ≈ 600MB–1GB; 4 workers + orchestrator + VS Code + dev servers + Docker ≈ 16GB; folga pro OS) |
| CPU | 8 cores físicos (16 threads) |
| Disco | 50 GB livre + SSD NVMe (worktrees + node_modules duplicado, ~5GB/cada) |
| Conexão | 50 Mbps estável |

Com 16GB você roda **2 workers** confortavelmente. 32GB destrava 4.

---

## 4. Setup inicial (uma vez por projeto)

Dentro do repo `tagix`, com o sistema `tasks/` instalado, num painel PowerShell:

```powershell
PS> Set-Location "$env:USERPROFILE\projects\tagix"

# Confirmar que slot.py funciona (Python via uv)
PS> uv run python scripts/slot.py status

# Criar diretório pai dos worktrees (irmão do repo)
PS> New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\projects\tagix-worktrees" | Out-Null
```

Abra o **Windows Terminal** e prepare os painéis: uma aba "orchestrator" + 4 painéis para workers (`Alt+Shift+D` divide; arraste/redimensione como preferir). Ou rode tudo de uma vez:

```powershell
# Abre uma janela do Windows Terminal com 1 painel orchestrator + 4 painéis worker
PS> wt -d "$env:USERPROFILE\projects\tagix" `
       ; split-pane -d "$env:USERPROFILE\projects\tagix" `
       ; split-pane -H -d "$env:USERPROFILE\projects\tagix" `
       ; split-pane -d "$env:USERPROFILE\projects\tagix" `
       ; split-pane -H -d "$env:USERPROFILE\projects\tagix"
```

> **Diferença pro mundo Linux:** no Windows não há equivalente limpo ao `tmux send-keys` pra o orchestrator digitar automaticamente nos painéis dos workers. O fluxo aqui é **despacho manual assistido**: o orchestrator monta os comandos de worktree + os prompts; **você cola** em cada painel. É um clique a mais por worker, e na prática nem atrapalha — você revisa o que vai despachar.

---

## 5. Iniciar o orchestrator

No painel 0 (orchestrator):

```powershell
PS> Set-Location "$env:USERPROFILE\projects\tagix"
PS> claude
```

No prompt do Claude, cole o **system prompt do orchestrator** (uma vez por sessão):

```
Você é o ORCHESTRATOR do desenvolvimento multi-agente do tagix (Highermind v2).

Suas responsabilidades:
1. Quando eu pedir uma feature, use /hm-tasks pra decompor em slots.
2. Use `uv run python scripts/slot.py plan-batch` pra escolher um lote de slots
   paralelizáveis (sem overlap em files_allowed).
3. Pra cada slot do lote, MONTE (não execute) os comandos pra eu colar num painel livre:
   - Criar worktree: git worktree add ..\tagix-worktrees\w<N> -b slot/<SLOT_ID> main
   - Entrar e abrir o worker: cd ..\tagix-worktrees\w<N> ; claude
   - Prompt inicial pro worker: "Implemente slot <SLOT_ID>. Leia tasks/PROTOCOL.md primeiro."
   Me entregue esses comandos em bloco, prontos pra colar.
4. Monitor: a cada minuto, leia tasks/STATUS.md e tasks/COMMS.md e me diga o estado.
5. Quando um worker terminar (slot status=done na branch dele):
   - Revise o diff
   - Se aprovado, faça merge (squash) em main, apague a branch, remova o worktree
   - Se não, me dê o feedback pra eu repassar ao worker
6. NUNCA escreva código você mesmo. Sua função é coordenar.

Regras duras:
- Nunca proponha dois workers para slots com overlap em files_allowed
  (slot.py plan-batch garante; valide mesmo assim).
- Anote toda decisão de despacho em tasks/COMMS.md com: data, slot, worker_id, motivo.
- Se em dúvida sobre prioridade, pergunte ao Rogério.

Comece perguntando: qual feature eu quero acelerar agora?
```

A partir daqui você conversa em alto nível: "Quero a F2 inteira em paralelo". Ele decompõe, monta os blocos de despacho, você cola nos painéis, ele monitora.

---

## 6. Workers: como funcionam por dentro

Cada worker é um `claude` rodando dentro de um worktree próprio. Você cola o prompt inicial que o orchestrator montou:

```
Implemente slot F2-S04. Leia tasks/PROTOCOL.md primeiro.
```

O `tasks/PROTOCOL.md` instrui o worker a:

1. `uv run python scripts/slot.py claim F2-S04 --as w1` — marca o slot como `in_progress`, owner `w1`.
2. Ler `tasks/slots/F2/F2-S04-*.md` — frontmatter tem `files_allowed`, `files_forbidden`, `depends_on`, DoD.
3. Implementar respeitando `files_allowed`. Edição fora dispara erro de validação.
4. `uv run python scripts/slot.py validate F2-S04` antes de fechar — checa DoD + roda comandos de validação.
5. Commit + push da branch `slot/F2-S04`.
6. Atualizar o frontmatter: `status: done`, `validated: true`.
7. Escrever 1 linha em `tasks/COMMS.md`: `[F2-S04][w1][done] PR pronto, peço review.`
8. Mensagem final: "Slot F2-S04 entregue, branch slot/F2-S04 pronta pra review."

---

## 7. Isolamento via Git worktree

Por que worktree e não `git clone`:

- `git clone` duplica o repo inteiro (.git pesado, lento).
- `git worktree add` cria diretório irmão com objetos compartilhados. Disco e clone instantâneo.

Workflow (PowerShell):

```powershell
# Criar worktree pra um slot
PS> git worktree add "$env:USERPROFILE\projects\tagix-worktrees\w1" -b slot/F2-S04 main

# Listar worktrees ativos
PS> git worktree list

# Após merge da branch, remover worktree
PS> git worktree remove "$env:USERPROFILE\projects\tagix-worktrees\w1"
PS> git branch -d slot/F2-S04
```

Cada worktree tem seu próprio `node_modules\` (rode `pnpm install` no primeiro setup) e `.next\` ou `dist\`. Builds não interferem entre si.

> **Limitação:** dois worktrees não podem fazer checkout da mesma branch. Por isso cada slot tem branch própria (`slot/<SLOT_ID>`).

---

## 8. Sessões Claude: o que é isolado vs compartilhado

| Recurso | Isolado por sessão? | Localização |
|---|---|---|
| Histórico da conversa | ✅ isolado | `~/.claude/sessions/<id>.jsonl` |
| Contexto runtime | ✅ isolado | RAM do processo `claude` |
| CLAUDE.md global | ❌ **compartilhado** | `~/.claude/CLAUDE.md` |
| Skills (`/hm-tasks`, etc.) | ❌ **compartilhado** | `~/.claude/skills/` |
| `settings.json` (permissões) | ❌ **compartilhado** | `~/.claude/settings.json` |
| **Memória persistente** | ❌ **compartilhada (vantagem grande!)** | `~/.claude/memory/` |
| CLAUDE.md do projeto | ❌ **compartilhado** (cada worker lê o do seu worktree) | `<projeto>/CLAUDE.md` |

**A memória compartilhada é o melhor recurso pra multi-agent:** quando o worker 1 aprende "neste projeto, sempre use `db.transaction(...)` em writes multi-tabela", isso vai pra `~/.claude/memory/` e o worker 2 lê automaticamente.

---

## 9. Canais de comunicação entre agentes

Não tem broker. Tudo via filesystem + Git:

| Canal | Conteúdo | Quem escreve | Quem lê |
|---|---|---|---|
| `tasks/STATUS.md` | Tabela autoritativa: cada slot, status, owner, branch | `slot.py sync` (automático) | Orchestrator + você |
| `tasks/COMMS.md` | Log append-only de eventos | Workers + orchestrator | Todos |
| Slot frontmatter | status, owner, validated, last_action | Worker dono via `slot.py claim/release` | Todos |
| Git branches `slot/<ID>` | Código em progresso | Worker dono | Orchestrator (no review) |
| Memória global (`~/.claude/memory/`) | Aprendizados sobre o projeto | Qualquer agente | Todos (próximas sessões) |

Regras:

- **Worker SÓ escreve no slot que claimou.** Se descobre que outro slot precisa de ajuste, escreve em COMMS.md pedindo, não toca.
- **Append-only em COMMS.md.** Nunca apaga. Audit trail.
- **`slot.py claim` é atômico** (lock de arquivo). Dois workers em claim simultâneo — um ganha, outro recebe erro.

---

## 10. Prevenindo conflitos: as três camadas

**Camada 1: `slot.py plan-batch`** — antes de despachar, retorna até N slots cujos `files_allowed` não têm interseção. Força dois em conflito → recusa.

```powershell
PS> uv run python scripts/slot.py plan-batch --size 4
F2-S04-tool-registry        files: packages/agents-client/**, apps/agent-runtime/app/tools/registry.py
F2-S05-column-acl           files: apps/agent-runtime/app/tools/database/**
F2-S06-worker-integration   files: apps/workers/src/inbound/handlers/agent.ts
✓ No conflicts. Safe to dispatch.
```

**Camada 2: pre-commit hook** — cada worktree tem hook que checa se os arquivos staged estão dentro de `files_allowed` do slot da branch (gerado por `slot.py init`). Falha o commit se algum estiver fora.

**Camada 3: `slot.py validate` antes do close:**

```powershell
PS> uv run python scripts/slot.py validate F2-S04
✓ All files modified are in files_allowed
✓ DoD checklist complete (8/8)
✓ Validation commands passed (pnpm test, pnpm typecheck)
Slot ready to release.
```

Se qualquer camada falha, worker fica parado e pede ajuda no COMMS.md.

---

## 11. Workflow completo de uma feature

Exemplo: "Implemente Phase F2 do agente runtime".

```
Você (orchestrator): "Quero F2 inteira em paralelo, prioridade na infra Python."

Orchestrator:
  → /hm-tasks (lê PRD/ARCHITECTURE/AGENTS_LANGGRAPH)
  → cria 6 slots: F2-S01..F2-S06
  → slot.py plan-batch --size 4 → F2-S01 (schema), depois lote {S02, S03, S04, S05}
  → monta despacho de S01 sozinho (deps de todos) → você cola em w1
  → ao S01 done: merge em main
  → monta despacho de S02..S05 → você cola em w1..w4
  → monitora STATUS.md a cada minuto
  → quando S04 termina: review com você, merge, libera w1
  → monta despacho de S06 (deps de S05)
  → ...
  → no fim: "F2 fechada. 6 PRs merged."
```

Seu papel: colar os despachos, aprovar PRs e gritar se algo parecer estranho.

---

## 12. Quanto isso custa em LLM?

Estimativa pra 4 workers + 1 orchestrator num dia de 4–6h:

- Orchestrator: ~300k tokens/dia. Cada worker: ~500k–1M tokens/dia. Total: ~3M tokens/dia.

Pra economizar, configure o modelo dos workers pra `sonnet` ou `haiku` e deixe o orchestrator no Opus. Dá pra criar um `settings.local.json` no worktree do worker forçando o modelo mais barato:

```powershell
# Dentro do worktree do worker:
PS> '{ "model": "sonnet" }' | Set-Content .claude\settings.local.json
```

---

## 13. Troubleshooting

### Worker 2 quer editar arquivo que pertence ao worker 1

→ `slot.py validate` bloqueia no commit. Worker 2 escreve em COMMS.md pedindo. Orchestrator decide: espera S01 fechar ou cria sub-slot dedicado.

### Dois workers commitaram em conflito no mesmo arquivo (não deveria)

→ `uv run python scripts/slot.py audit-overlap` mostra qual slot mentiu sobre `files_allowed`. Corrige o frontmatter, sincroniza, refaz.

### Painel "perdeu" o claude

→ Volte ao painel (Alt+Setas no Windows Terminal). Se o claude saiu, rode `claude` de novo no mesmo worktree — sessão nova, mas o slot continua claimado pra ele.

### Worker travado num erro infinito

→ `Ctrl+C` no painel dele. Depois `uv run python scripts/slot.py release F2-S04 --reason "agent stuck"` libera o slot.

### Disco enchendo (4 node_modules + builds)

→ Cada worktree tem ~3–5GB. pnpm já usa store global compartilhado (default no pnpm 9); rode `pnpm clean` nos worktrees ociosos.

### Orchestrator perdeu contexto (sessão longa)

→ `/compact` no orchestrator. Ele mantém ponteiros pra `tasks/STATUS.md` e `tasks/COMMS.md` (source-of-truth), então a perda é recuperável.

### Quero pausar tudo

→ Mande `/exit` em cada worker pra fechar a sessão (economiza tokens). Os painéis do Windows Terminal continuam; amanhã você abre `claude` de novo.

---

## 14. Boas práticas

1. **Slot é a fronteira sagrada.** "Ah, é só editar esse outro arquivo rapidinho" → PARA. Cria sub-slot.
2. **Worker focado em uma camada.** Schema + service + frontend numa só sessão = worker perdido. Quebre.
3. **`tasks/COMMS.md` é fofoca útil.** Lê de vez em quando — descobre coisa estranha que vale investigar.
4. **Não rode mais workers do que você consegue revisar.** 4 PRs/dia é digerível; 12 viram pilha morta.
5. **Memória global é compounding.** Decisão técnica que TODOS os agentes devem saber: peça "salva isso na memória". Vai pra `~/.claude/memory/`, outros leem.
6. **PR pequeno mata bug grande.** 200 linhas revisa em 5 min; 2000 linhas é onde bug se esconde.

---

> Runbook mantido por: Rogério. Multi-agent dev exige disciplina de slots. Se virar bagunça, reduza pra 2 workers até estabilizar.
