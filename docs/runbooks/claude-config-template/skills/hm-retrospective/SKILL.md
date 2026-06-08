---
name: hm-retrospective
description: Retrospectiva pós-slot ou pós-fase. Identifica aprendizados concretos e propõe quais viram memória persistente em ~/.claude/memory/ pra próximos slots herdarem. Use sempre que fechar um slot não-trivial, no fim de cada fase, ou quando o Rogério pedir "o que aprendemos".
---

# /hm-retrospective — Retrospectiva e consolidação de aprendizado

Você está em **modo de extração de conhecimento**. O trabalho fechou; sua função é identificar **o que ficou caro descobrir** e transformar em **memória persistente** pra próximas sessões / próximos slots / próximos agentes não pagarem o mesmo preço.

## Postura

- Foco no aprendizado não-óbvio. Coisa óbvia já está nos docs.
- Honestidade sobre o que foi mal. Não suaviza. Não exagera.
- Não é cerimônia. Não é "lições aprendidas" genérica de PMI. É **patrimônio de conhecimento prático** que vai acelerar o próximo trabalho.

## Entradas

- **escopo** — slot fechado, lote de slots, ou fase inteira. Identifique o que está retrospectando.
- **gatilho opcional** — algo específico que o Rogério quer destrinchar (ex: "por que o F2-S04 demorou 3× o estimado?").

## Execução

### 1. Reunir evidência

Leia em ordem:

1. **Os slots envolvidos** em `tasks/slots/<fase>/` — frontmatter + corpo + DoD validada.
2. **`tasks/COMMS.md`** — eventos do período do escopo (claim, done, dúvidas, decisões).
3. **Os PRs/commits da fase** (`git log slot/F<n>-*..main --oneline`) — diferença entre o planejado e o entregue.
4. **Logs de erro** se houver (CI red, validation failures, `git revert`).
5. **Memória global atual** (`~/.claude/memory/`) — pra não duplicar conhecimento já registrado.

### 2. Categorizar achados

Organize em 4 categorias estritas:

| Categoria | O que vai aqui |
|---|---|
| **Decisão técnica não-óbvia** | Escolha de stack/lib/padrão que custou tempo descobrir e vale pros próximos (ex: "OpenRouter API key precisa do header HTTP-Referer pra aparecer corretamente no analytics deles") |
| **Armadilha do stack** | Comportamento contraintuitivo do TypeScript/Drizzle/Postgres/Next.js/agent-runtime Python/Meta API que mordeu (ex: "Drizzle infere coluna `text NULL` como `string` em vez de `string \| null` quando a migration esquece NULL explícito") |
| **Padrão de escopo** | Como decompor melhor da próxima vez (ex: "Slots que tocam adapter Meta + frontend ao mesmo tempo passam de 500 linhas; quebrar adapter primeiro, frontend depois") |
| **Padrão de processo** | Como coordenar melhor multi-agente da próxima vez (ex: "Quando 2+ slots tocam migrations sequenciais, melhor enfileirar em vez de paralelizar — colisão de numeração") |

### 3. Filtrar pelo critério de retenção

Pra cada achado, pergunte: **vale guardar em memória persistente?**

Sim, se:
- Vai economizar tempo em **outro slot** ou **outro projeto**.
- É não-óbvio (não está nos docs já existentes).
- É verificável (você pode citar arquivo/commit/decisão).

Não, se:
- É trivial ("tive que dar `npm install`").
- É específico de um bug que já está corrigido e não vai voltar.
- Já está documentado em `docs/` ou em memória existente.
- É emocional ("foi difícil") — sem fato, sem retenção.

### 4. Propor entradas de memória

Pra cada achado que passa no filtro, redija a entrada de memória pronta pra salvar, no formato:

```yaml
---
type: <decisao_tecnica | armadilha_stack | padrao_escopo | padrao_processo>
domain: <stack/área específica>
source: <slot_id ou ADR_id ou commit_sha>
created: <YYYY-MM-DD>
---
**Aprendizado:** uma frase clara.
**Contexto:** quando isso se manifesta.
**Como agir:** o que fazer / evitar.
**Por que importa:** o custo se ignorado.
```

Exemplo concreto:

```yaml
---
type: armadilha_stack
domain: meta-instagram-adapter
source: F1.5-S03
created: 2026-06-15
---
**Aprendizado:** URLs de mídia em story_mention do Instagram expiram em ~5 minutos, não 1 hora.
**Contexto:** Worker media que processa fila `hm.q.inbound.media` com prefetch 10 e backlog real.
**Como agir:** Atribua prioridade alta no envelope da queue + retry agressivo (3× em <4min). Não confie no padrão.
**Por que importa:** Perde a mídia do story; usuário vê placeholder pra sempre.
```

### 5. Apresentar ao Rogério

Saída em três blocos:

**A. Resumo:**
- Escopo retrospectado.
- N achados totais, M propostos pra memória.

**B. Lista de achados propostos pra memória** (com os yaml prontos).

**C. Lista de achados descartados** (1 linha cada, com motivo do descarte — pra ele revisar se discorda).

### 6. Pós-aprovação

Quando o Rogério aprovar (todos ou subset):

1. Escreva cada entrada em `~/.claude/memory/<tipo>/<slug>.md`.
2. Commit em `~/claude-config` se for via runbook de sync, ou registre que ainda precisa subir.
3. Anote em `tasks/COMMS.md`: `[RETROSPECTIVE][data] N aprendizados consolidados em ~/.claude/memory/. Próximos slots já se beneficiam.`

### 7. Loop curto opcional

Se o gatilho da retrospectiva for "por que demorou 3×":

- Identifique a fonte do estouro (escopo subestimado? bug de dependência? múltiplas correções de curso?).
- Atualize a estimativa de tamanho em `tasks/_TEMPLATE.md` se for padrão recorrente.
- Sugira ajuste em `docs/ROADMAP.md` se a estimativa da fase precisa recalibrar.

## Halt conditions

- HALT se o escopo é trivial (1 slot XS, 1 commit) — não tem aprendizado real, pula.
- HALT se a fase ainda está aberta com slots `in_progress` — espere fechar pra ter o quadro completo.
- HALT se há nenhuma fonte de evidência (sem COMMS, sem commits informativos) — você não pode retrospectar do nada; peça mais contexto.

## Anti-padrões

- Não escreva "aprendi a usar Drizzle" — isso é estado, não aprendizado.
- Não invente lição. Toda entrada de memória tem `source` rastreável.
- Não consolidar tudo num arquivo único de memória. Granularidade alta (1 arquivo por aprendizado) ajuda a recuperação seletiva.
- Não duplique conhecimento que já está em `docs/MIGRATION_NOTES.md` ou em ADRs.
- Não trate como cerimônia. Se em 5 minutos você fez, ótimo. Se demorou 30, você sobre-engenhou.

## Cadência sugerida

- Após cada slot **M ou L** (não XS/S).
- No fim de cada fase do ROADMAP.
- Quando o Rogério pedir.
- Se `tasks/COMMS.md` cresceu muito sem nenhuma retrospectiva — algo ficou sem consolidar.

## Memória cumulativa = sua vantagem composta

Cada slot adiciona conhecimento → próximo slot começa mais avançado → próxima fase é mais rápida → próximo projeto pega o stack já mapeado. Essa é a vantagem real de versionar `~/.claude/memory/` no `claude-config`.
