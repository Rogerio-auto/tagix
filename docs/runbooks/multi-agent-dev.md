# Runbook — Desenvolvimento multi-agente com Claude Code

> **Para quem:** Rogério acelerando o desenvolvimento do Highermind v2 com 3–4 agentes Claude em paralelo, sem race conditions, conflitos de merge ou pisadas de pé.
> **Arquitetura:** 1 agente Claude **orchestrator** num terminal dedicado + 3–4 agentes Claude **worker** em terminais separados, cada um num **Git worktree próprio**, isolados via **slots com `files_allowed`** (contrato de fronteira).
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
| **Slots com `files_allowed`** | Cada slot declara explicitamente quais arquivos pode tocar. Tool `slot.py plan-batch` rejeita slots com overlap. | Conflito de merge, sobrescrita silenciosa |
| **Git worktrees** | Cada agente trabalha num diretório paralelo do mesmo repo, com sua branch isolada. Filesystem isolado, objetos Git compartilhados. | Race em `git status`, builds simultâneos quebrados |
| **Orchestrator Claude dedicado** | 1 agente Claude principal num terminal que decompõe, despacha, monitora. Nunca implementa código direto. | Você (humano) virar gargalo de coordenação |

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
        Terminal 0 (Window principal — sempre aberto)
        ┌────────────────────────────────────────────────────────┐
        │  claude  (modo orchestrator)                            │
        │  ────────────────────────────────────────────────       │
        │  Skills: /hm-tasks, /hm-engineer, /hm-qa, ...           │
        │  Permissões: pode rodar tmux, git, slot.py              │
        │  Função: decompor features, despachar workers,          │
        │          monitorar STATUS.md, revisar PRs.              │
        │  NÃO escreve código direto.                             │
        └────────┬───────────────────────────────────────────────┘
                 │ tmux send-keys / spawn
                 │
        ┌────────┴──────────────────┬──────────────────┬──────────────────┐
        ▼                           ▼                  ▼                  ▼
  Tmux pane 1                Tmux pane 2        Tmux pane 3        Tmux pane 4
  ┌──────────────┐          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ worktree-1   │          │ worktree-2   │   │ worktree-3   │   │ worktree-4   │
  │              │          │              │   │              │   │              │
  │ slot F2-S04  │          │ slot F2-S05  │   │ slot F2-S06  │   │ (livre)      │
  │ branch:      │          │ branch:      │   │ branch:      │   │              │
  │ slot/F2-S04  │          │ slot/F2-S05  │   │ slot/F2-S06  │   │              │
  │              │          │              │   │              │   │              │
  │ claude       │          │ claude       │   │ claude       │   │ (esperando)  │
  │ (worker)     │          │ (worker)     │   │ (worker)     │   │              │
  └──────────────┘          └──────────────┘   └──────────────┘   └──────────────┘
        │                           │                  │                  │
        └───────────────────────────┴──────────────────┴──────────────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │  Repo highermind-v2  │
                          │                      │
                          │  tasks/STATUS.md    ← autoritativo: quem faz o quê
                          │  tasks/COMMS.md     ← log compartilhado (append-only)
                          │  tasks/slots/F*/    ← slot files com frontmatter
                          │  scripts/slot.py    ← validation + plan-batch
                          │  .git/              ← objetos compartilhados
                          └─────────────────────┘
```

Pontos importantes:

1. **Um repo, vários worktrees.** `git worktree add ../highermind-v2-w2 main` cria um diretório irmão completo, com sua própria working copy, mas compartilhando os objetos Git do repo principal. Não duplica histórico no disco.
2. **Sessões Claude isoladas, contexto base compartilhado.** Cada `claude` no tmux pane é uma sessão independente (não enxerga as conversas dos outros). MAS todos leem o mesmo `~/.claude/CLAUDE.md` global e a mesma `~/.claude/memory/` — então a identidade e regras são uniformes.
3. **Comunicação via filesystem + Git.** Não tem socket nem broker. Cada agente lê `tasks/STATUS.md`, atualiza o frontmatter do próprio slot, faz commits. Orchestrator monitora.

---

## 3. Pré-requisitos

### 3.1 Skills já instaladas

Você já tem (vide `claude-code-sync.md`):

- `/hm-tasks` — decompõe features em slots com `files_allowed`
- `/hm-engineer` — implementa um slot
- `/hm-qa` — testa um slot pronto
- `/hm-security` — auditoria final

Estas são os papéis dos workers.

### 3.2 Sistema `tasks/` no projeto

O `/hm-init` (passo 10) instala isto no repo do Highermind v2:

```
highermind-v2/
├── tasks/
│   ├── PROTOCOL.md          # contrato lido por todo agente: como pegar slot, abrir branch, fazer commit
│   ├── STATUS.md            # gerado por slot.py sync — quem está fazendo o quê
│   ├── COMMS.md             # log append-only de mensagens entre agentes
│   ├── _TEMPLATE.md         # template de slot
│   └── slots/
│       ├── F0/
│       ├── F1/
│       ├── F2/
│       └── ...
└── scripts/
    └── slot.py              # CLI: status, plan-batch, validate, sync, claim, release
```

Se ainda não tem, rode `/hm-init` no projeto e o passo 10 cria.

### 3.3 Tmux instalado no Ubuntu

```bash
$ sudo apt install -y tmux
```

Por que tmux: permite o orchestrator Claude abrir panes/janelas, despachar comandos em cada, e você ver todos juntos. Alternativa moderna: **Zellij** (visual mais bonito). Tmux é mais ubíquo e robusto.

### 3.4 Hardware mínimo recomendado

Pra 3–4 workers simultâneos:

| Recurso | Mínimo confortável |
|---|---|
| RAM | 32 GB (cada `claude` = 600MB–1GB; 4 workers + orchestrator + VS Code + dev servers + Docker = ~16GB; folga pra OS) |
| CPU | 8 cores físicos (16 threads) |
| Disco | 50 GB livre + SSD NVMe (worktrees + node_modules duplicado em build, ~5GB/cada) |
| Conexão | 50 Mbps estável (4 claudes fazendo chamadas a API simultaneamente) |

Com 16GB você consegue rodar **2 workers** confortavelmente. 32GB destrava 4.

---

## 4. Setup inicial (uma vez por projeto)

Dentro do repo `highermind-v2`, com o sistema `tasks/` instalado:

```bash
$ cd ~/projects/highermind-v2

# Confirmar que slot.py funciona
$ python scripts/slot.py status

# Criar diretório pai dos worktrees (irmão do repo, fora do .gitignore)
$ mkdir -p ~/projects/highermind-v2-worktrees

# Iniciar sessão tmux nomeada "hm"
$ tmux new-session -d -s hm
$ tmux rename-window -t hm:0 orchestrator

# Abrir 4 janelas extras (uma por worker em potencial)
$ for i in 1 2 3 4; do tmux new-window -t hm -n "w$i"; done

# Voltar pra janela 0 (orchestrator)
$ tmux select-window -t hm:0

# Anexar
$ tmux attach -t hm
```

Atalhos tmux essenciais:

| Atalho | Ação |
|---|---|
| `Ctrl+B` então `n` | próxima janela |
| `Ctrl+B` então `p` | janela anterior |
| `Ctrl+B` então `0..9` | ir pra janela N |
| `Ctrl+B` então `d` | sair do tmux mantendo tudo rodando |
| `tmux attach -t hm` | voltar |
| `Ctrl+B` então `w` | menu interativo de janelas |

---

## 5. Iniciar o orchestrator

Na janela 0 do tmux (orchestrator):

```bash
$ cd ~/projects/highermind-v2
$ claude
```

No prompt do Claude, cole o **system prompt do orchestrator** (você só precisa colar isso uma vez por sessão):

```
Você é o ORCHESTRATOR do desenvolvimento multi-agente do Highermind v2.

Suas responsabilidades:
1. Quando eu pedir uma feature, use /hm-tasks pra decompor em slots.
2. Use `python scripts/slot.py plan-batch` pra escolher um lote de slots
   paralelizáveis (sem overlap em files_allowed).
3. Pra cada slot do lote, abra um worker numa janela tmux livre:
   - Identifique janela livre: `tmux list-windows -t hm -F "#{window_index} #{window_name}"`
   - Cria worktree: `git worktree add ../highermind-v2-worktrees/w<N> -b slot/<SLOT_ID> main`
   - Despacha worker: `tmux send-keys -t hm:w<N> "cd <PATH> && claude" Enter`
   - Espera 5s, manda o prompt: `tmux send-keys -t hm:w<N> "Implemente slot <SLOT_ID>. Leia tasks/PROTOCOL.md primeiro." Enter`
4. Monitor: a cada minuto, verifique `tasks/STATUS.md` e `tasks/COMMS.md`.
5. Quando um worker terminar (slot status=done na branch dele):
   - Revise o diff
   - Se aprovado, faça merge (squash) em main, apague a branch, remova o worktree
   - Se não, retorne ao worker com feedback
6. NUNCA escreva código você mesmo. Sua função é coordenar.

Regras duras:
- Nunca mande dois workers para slots que tenham overlap em files_allowed
  (slot.py plan-batch garante isso, mas valide).
- Antes de spawnar worker, confirme que a janela tmux alvo está realmente livre
  (não tem claude rodando).
- Anote toda decisão de despacho em tasks/COMMS.md com: data, slot, worker_id, motivo.
- Se em dúvida sobre prioridade, pergunte ao Rogério.

Comece perguntando: qual feature eu quero acelerar agora?
```

A partir daqui, você conversa em alto nível: "Quero a F2 inteira em paralelo" ou "Foca em F1.5-S02..06 simultâneo". Ele decompõe, despacha, monitora.

---

## 6. Workers: como funcionam por dentro

Cada worker (janela `w1`, `w2`, etc.) é um `claude` rodando dentro de um worktree próprio. O orchestrator manda o prompt inicial:

```
Implemente slot F2-S04. Leia tasks/PROTOCOL.md primeiro.
```

O `tasks/PROTOCOL.md` instrui o worker a:

1. `python scripts/slot.py claim F2-S04 --as w1` — marca o slot como `in_progress`, owner `w1`.
2. Leia `tasks/slots/F2/F2-S04-*.md` — frontmatter tem `files_allowed`, `files_forbidden`, `depends_on`, DoD.
3. Implemente respeitando `files_allowed`. Qualquer edição fora dispara erro de validação.
4. Rode `python scripts/slot.py validate F2-S04` antes de fechar — checa DoD checklist + roda comandos de validação do slot.
5. Commit + push da branch `slot/F2-S04`.
6. Atualize o slot frontmatter: `status: done`, `validated: true`.
7. Escreva 1 linha em `tasks/COMMS.md`: `[F2-S04][w1][done] PR pronto, peço review.`
8. Mensagem final: "Slot F2-S04 entregue, branch slot/F2-S04 pronta pra review."

Cada worker termina e fecha. O `claude` continua rodando esperando próximo prompt — ou o orchestrator manda `/exit` no worker pra liberar a janela.

---

## 7. Isolamento via Git worktree

Por que worktree e não `git clone`:

- `git clone` dupla o repo inteiro (.git pesado, lento).
- `git worktree add` cria diretório irmão com objetos compartilhados. Disco e clone instantâneo.

Workflow:

```bash
# Criar worktree pra um slot
$ git worktree add ~/projects/highermind-v2-worktrees/w1 -b slot/F2-S04 main

# Listar worktrees ativos
$ git worktree list
~/projects/highermind-v2                       [main]
~/projects/highermind-v2-worktrees/w1          [slot/F2-S04]
~/projects/highermind-v2-worktrees/w2          [slot/F2-S05]

# Após merge da branch, remover worktree
$ git worktree remove ~/projects/highermind-v2-worktrees/w1
$ git branch -d slot/F2-S04

# Lista pra confirmar
$ git worktree list
```

Cada worktree tem seu próprio `node_modules/` (rode `pnpm install` no primeiro setup) e `.next/` ou `dist/`. Builds não interferem entre si.

> **Limitação:** dois worktrees não podem fazer checkout da mesma branch. Por isso cada slot tem branch própria (`slot/<SLOT_ID>`).

---

## 8. Sessões Claude: o que é isolado vs compartilhado

| Recurso | Isolado por sessão? | Localização |
|---|---|---|
| Histórico da conversa | ✅ isolado (cada sessão tem seu turno) | `~/.claude/sessions/<id>.jsonl` |
| Contexto runtime (variáveis, decisões in-progress) | ✅ isolado | RAM do processo `claude` |
| CLAUDE.md global | ❌ **compartilhado** (lido por todos) | `~/.claude/CLAUDE.md` |
| Skills (`/hm-tasks`, etc.) | ❌ **compartilhado** | `~/.claude/skills/` |
| `settings.json` (permissões) | ❌ **compartilhado** | `~/.claude/settings.json` |
| **Memória persistente** | ❌ **compartilhada (vantagem grande!)** | `~/.claude/memory/` |
| CLAUDE.md do projeto | ❌ **compartilhado** (cada worker lê o do seu worktree, mas é o mesmo arquivo conceitualmente) | `<project>/CLAUDE.md` |

**A memória compartilhada é o melhor recurso pra multi-agent:** quando o worker 1 aprende "no projeto X, sempre use `db.transaction(...)` ao invés de `pool.query(...)` em writes multi-tabela", essa memória vai pra `~/.claude/memory/` e o worker 2 lê automaticamente. Conhecimento sobre o projeto consolida entre todos.

---

## 9. Canais de comunicação entre agentes

Não tem broker. Tudo via filesystem + Git:

| Canal | Conteúdo | Quem escreve | Quem lê |
|---|---|---|---|
| `tasks/STATUS.md` | Tabela autoritativa: cada slot, seu status, owner, branch | `slot.py sync` (automático) | Orchestrator + você |
| `tasks/COMMS.md` | Log append-only de eventos: "[F2-S04][w1] claim", "[F2-S04][w1] done", "[orchestrator] merged" | Workers + orchestrator | Todos |
| Slot frontmatter (`tasks/slots/F2/F2-S04-*.md`) | status, owner, validated, last_action | Worker dono via `slot.py claim/release` | Todos |
| Git branches `slot/<ID>` | Código em progresso | Worker dono | Orchestrator (no review) |
| Memória global (`~/.claude/memory/`) | Aprendizados sobre o projeto | Qualquer agente | Todos (próximas sessões) |

Regras:

- **Worker SÓ escreve no slot que claimou.** Se descobre que outro slot precisa de ajuste, escreve em COMMS.md pedindo, não toca.
- **Append-only em COMMS.md.** Nunca apaga. Audit trail.
- **`slot.py claim` é atômico.** Implementado com lock de arquivo. Dois workers que tentam claim simultâneo no mesmo slot — um ganha, outro recebe erro.

---

## 10. Prevenindo conflitos: as três camadas

**Camada 1: `slot.py plan-batch`**

Antes de despachar um lote, `slot.py plan-batch --size 4` retorna até 4 slots cujos `files_allowed` não têm interseção. Se você forçar dois slots em conflito, recusa.

```bash
$ python scripts/slot.py plan-batch --size 4
F2-S04-tool-registry        files: packages/agents-client/**, apps/agent-runtime/app/tools/registry.py
F2-S05-column-acl           files: apps/agent-runtime/app/tools/database/**
F2-S06-worker-integration   files: apps/workers/src/inbound/handlers/agent.ts
F2-S08-policy-snapshot      files: apps/agent-runtime/app/policy.py
✓ No conflicts. Safe to dispatch.
```

**Camada 2: pre-commit hook**

Cada worktree tem hook que checa se os arquivos do commit estão dentro de `files_allowed` do slot da branch:

```bash
# .git/hooks/pre-commit (gerado por slot.py init)
SLOT_ID=$(git symbolic-ref --short HEAD | sed 's|^slot/||')
python scripts/slot.py check-commit $SLOT_ID --staged
# Falha se algum arquivo staged está fora de files_allowed
```

**Camada 3: `slot.py validate` antes do close**

```bash
$ python scripts/slot.py validate F2-S04
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
Você (no orchestrator): "Quero F2 inteira em paralelo, prioridade na infra Python."

Orchestrator:
  → /hm-tasks (lê PRD/ARCHITECTURE/AGENTS_LANGGRAPH)
  → cria 6 slots: F2-S01..F2-S06
  → slot.py plan-batch --size 4
    → retorna F2-S01 (schema), depois lote {S02, S03, S04, S05}
  → despacha S01 sozinho em w1 (deps de todos)
  → espera S01 done
  → ao S01 done: merge em main
  → despacha S02, S03, S04, S05 em w1, w2, w3, w4
  → monitora STATUS.md a cada minuto
  → quando S04 termina: review com você, merge, libera w1
  → despacha S06 em w1 (deps de S05)
  → ...
  → no fim: "F2 fechada. 6 PRs merged em 8h. Saldo na conta OpenRouter: $4.32."
```

Seu papel: aprovar PRs e gritar se algo parecer estranho.

---

## 12. Quanto isso custa em LLM?

Estimativa pra 4 workers + 1 orchestrator num dia de trabalho de 4–6h:

- Orchestrator: ~300k tokens/dia (lê docs, monitora, planeja).
- Cada worker: ~500k–1M tokens/dia (lê código, implementa, testa).
- Total: ~3M tokens/dia.

Com `claude-opus-4` em modo padrão: ~$45–60/dia útil. Caro mas rápido. Pra economizar, configure no `settings.json` o modelo padrão como `sonnet-4-6` ou `haiku-4-5` pros workers — o orchestrator fica com Opus.

Pode até criar um `settings.json` específico no worktree (`~/projects/highermind-v2-worktrees/w1/.claude/settings.local.json`) forçando Sonnet ou Haiku só pra workers.

---

## 13. Troubleshooting

### Worker 2 quer editar arquivo que pertence ao worker 1

→ `slot.py validate` bloqueia no commit. Worker 2 escreve em COMMS.md: "Preciso ajustar `packages/db/schema.ts` mas pertence ao F2-S01. Posso?" Orchestrator decide: ou espera S01 fechar, ou cria sub-slot dedicado.

### Dois workers fizeram commit em conflito no mesmo arquivo (não deveria, mas...)

→ Auditoria: rode `python scripts/slot.py audit-overlap`. Mostra qual slot mentiu sobre `files_allowed`. Corrige o frontmatter, sincroniza, refaz.

### Tmux pane "perdeu" o claude depois de inatividade

→ Reanexe: `tmux attach -t hm`. Vá pra janela do worker (`Ctrl+B 1..4`). Se o claude saiu, rode `claude` de novo no mesmo worktree — sessão nova, mas slot ainda claimado pra ele.

### Worker ficou travado num erro infinito

→ Você manda `Ctrl+C` na pane dele. Depois `python scripts/slot.py release F2-S04 --reason "agent stuck"` — libera o slot pra outro worker pegar.

### Disco enchendo (4 node_modules + builds)

→ Cada worktree tem ~3-5GB de `node_modules` + build artifacts. Solução: configure pnpm com store global compartilhado (já é default em pnpm 9), e/ou rode `pnpm clean` periodicamente nos worktrees que não estão usando.

### Orchestrator perdeu contexto (sessão muito longa)

→ Use `/compact` no orchestrator pra comprimir conversa antiga em sumário. Ele mantém ponteiros pra `tasks/STATUS.md` e `tasks/COMMS.md` que são source-of-truth, então perda de contexto é recuperável.

### Quero pausar tudo pra dormir

→ `Ctrl+B d` no tmux: detach. Tudo continua rodando. Pra economizar dinheiro, antes mande "/exit" em cada worker pra fechar a sessão. Tmux mantém os shells abertos; amanhã você abre claude de novo.

---

## 14. Boas práticas que aprendi

1. **Slot é a fronteira sagrada.** Se você se pega pensando "ah, é só editar esse outro arquivo rapidinho", PARA. Cria sub-slot.
2. **Worker focado em uma camada.** Worker que tenta fazer schema + service + frontend numa só sessão fica perdido. Quebre.
3. **`tasks/COMMS.md` é fofoca útil.** Lê de vez em quando — você descobre que o worker 2 está achando coisa estranha que vale investigar.
4. **Não rode mais workers do que você consegue revisar.** 4 PRs/dia é digerível. 12 viram pilha morta.
5. **Memória global é seu compounding.** Toda decisão técnica do projeto que você quer que TODOS os agentes saibam: peça pro Claude salvar com "salva isso na memória". Vai pra `~/.claude/memory/`, outros workers leem.
6. **PR pequeno mata bug grande.** Slot com 200 linhas de diff revisa em 5 min. Slot com 2000 linhas é onde bug se esconde.

---

## 15. Adicional: alternativa minimalista (sem tmux)

Se prefere usar VS Code Terminal (split panes nativo) em vez de tmux:

- VS Code Remote-WSL com 4 terminais split (`Ctrl+Shift+5`).
- Cada terminal `cd` no seu worktree.
- Orchestrator num terminal, workers nos outros.
- Trade-off: orchestrator não consegue mais despachar comandos pros outros terminais automaticamente. Você cola os prompts em cada terminal manualmente.
- Vale a pena se você prefere visual unificado do VS Code e está OK com despacho manual.

---

> Runbook mantido por: Rogério. Multi-agent dev exige disciplina de slots. Se sentir que está virando bagunça, reduza pra 2 workers até o sistema estabilizar.
