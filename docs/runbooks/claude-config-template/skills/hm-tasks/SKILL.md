# /hm-tasks — Decompor feature em slots

Voce esta em **modo decomposicao de tarefas**. O fundador descreveu uma feature ou conjunto de features; seu trabalho e quebrar isso em **slots executaveis** seguindo o sistema instalado em `tasks/`.

## Pre-condicao

O projeto deve ter o sistema de tasks ja instalado:
- `tasks/PROTOCOL.md` existe
- `tasks/_TEMPLATE.md` existe
- `tasks/slots/F<n>/` existe (pelo menos `F0/`)
- `scripts/slot.py` funciona (`python scripts/slot.py --help`)

Se nao existe, **pare** e oriente o fundador a rodar `/hm-init` primeiro (passo 10).

## Seu trabalho

Quando o fundador descrever uma feature, voce:

### 1. Entende a feature inteira ANTES de decompor

- Leia o que o fundador descreveu. Faca UMA pergunta de esclarecimento se algo critico esta vago (entrada/saida, integracao externa, regra de negocio chave). Apenas uma.
- Leia `tasks/STATUS.md` ou rode `python scripts/slot.py status` para entender em que fase o projeto esta.
- Leia `CLAUDE.md` do projeto + `ARCHITECTURE.md` para conhecer stack e padroes.
- **Se a feature toca frontend, leia OBRIGATORIAMENTE `docs/UX_PRINCIPLES.md`.** Ele lista anti-padroes nomeados do v1 (gear-only entry, drag-text-overlap, full-screen modal, etc.) que o slot precisa evitar, e princípios positivos que deve aplicar.
- **Se a feature mexe em permissoes/acessos, leia `docs/features/PERMISSIONS.md`** pra entender matriz de roles + 3 niveis de configuracao (pessoal/workspace/plataforma).
- **Se a feature toca dashboard ou metricas, leia `docs/features/DASHBOARD.md`** pra entender visao role-aware + sistema de conversoes.
- Leia o frontmatter de slots ja existentes (`Glob "tasks/slots/F*/*.md"`) para entender:
  - Convencoes de naming usadas
  - Numero da proxima fase/slot livre
  - Padroes de `files_allowed` (paths reais do projeto)

### 2. Decide a granularidade

**Tamanho-alvo:** cada slot e executavel por **um agente em uma unica sessao**, sem precisar tocar arquivos de outros slots em paralelo. Isso normalmente significa:

- **XS:** 1-2 arquivos, < 50 linhas de codigo (ex: corrigir helper, adicionar utility puro).
- **S:** 2-5 arquivos, 50-200 linhas (ex: criar schema + CRUD simples).
- **M:** 5-10 arquivos, 200-500 linhas (ex: modulo completo com routes + service + repo + testes).
- **L:** 10+ arquivos, 500+ linhas (ex: refactor cross-cutting). Considere quebrar em M's.

**Anti-padrao:** slot que pede pra "implementar o sistema de auth inteiro" — quebra em (1) schema de identidade, (2) hash/JWT helpers, (3) login/refresh/logout endpoints, (4) middleware authenticate, (5) frontend de login.

### 3. Identifica `depends_on` corretamente

Para cada slot novo, liste explicitamente quais slots (existentes ou novos) precisam estar `done` antes. Regras:

- Schema vem antes do CRUD que o consome.
- Helpers vem antes de endpoints que os usam.
- Backend vem antes de frontend que o consome (a menos que sejam slots paralelos com contrato fixo).
- Auth/middleware vem antes de rotas protegidas.

Se A depende de B mas B nao esta listado, B vira um novo slot tambem.

### 4. Define `files_allowed` com precisao

`files_allowed` e o **contrato de isolamento**. Dois slots NUNCA podem ter overlap (o `plan-batch` do orchestrator vai rejeitar). Regras:

- Use globs onde fizer sentido (`apps/api/src/modules/auth/**`).
- Liste arquivos especificos para shared paths (`packages/shared-schemas/src/auth.ts`).
- Para re-exports compartilhados (`packages/shared-schemas/src/index.ts`), permita o slot adicionar mas marque como `files_forbidden` para outros slots — ou crie um slot dedicado de "exports".
- Se dois slots PRECISAM tocar o mesmo arquivo, eles **nao sao paralelos** — sequencie-os via `depends_on`.

### 5. Escreve cada slot usando o `_TEMPLATE.md`

Para cada slot:

1. Copie o conteudo de `tasks/_TEMPLATE.md` como base.
2. Preencha o frontmatter:
   - `id` — `F<n>-S<NN>-<slug>` (kebab-case slug, max ~5 palavras).
   - `title` — imperativo, curto (ex "Auth login refresh logout").
   - `phase` — qual fase F<n>.
   - `task_ref` — referencia em `docs/` se houver (ex `docs/tasks.md#T1.2`); senao `null`.
   - `status: available` se deps satisfeitos, `blocked` caso contrario.
   - `priority` — `critical | high | medium | low` baseado em desbloqueio downstream.
   - `estimated_size` — XS/S/M/L.
   - `depends_on` — lista de slot IDs.
   - `blocks` — informativo, slot IDs que isso vai desbloquear.
   - `source_docs` — paths em `docs/` que originaram o slot.
3. Preencha o corpo:
   - **Objetivo:** 1 frase, em termos de capacidade entregue.
   - **Contexto:** 1-3 frases sobre o porque e o que desbloqueia.
   - **Escopo (faz):** bullets de acoes concretas.
   - **Fora de escopo:** bullets do que parece relacionado mas e outro slot.
   - **Arquivos permitidos:** paths reais.
   - **Arquivos proibidos:** paths que outro slot e dono.
   - **Contratos de entrada/saida:** APIs/schemas/eventos.
   - **Definition of Done:** checklist com itens verificaveis.
   - **UX considerations (apenas slots de frontend):** lista de regras de `docs/UX_PRINCIPLES.md §2/§3` que o slot evita ou aplica, com numeracao. Se nao conseguir listar nenhuma, voce nao entendeu o escopo de UX do slot.
   - **Permission scope (se o slot mexe em endpoint/UI sensivel):** quais roles podem usar a feature; cite a entrada em `docs/features/PERMISSIONS.md §2`.
   - **Validacao:** comandos shell em code fence que `slot.py validate` vai executar.
   - **Notas:** gotchas, exemplos, decisoes nao obvias.
4. Escreva em `tasks/slots/F<n>/<slot-id>.md` usando `Write`.

### 6. Atualiza o board

Apos criar todos os slots:

```powershell
python scripts/slot.py sync
```

Isso re-renderiza `tasks/STATUS.md` a partir dos novos frontmatters.

### 7. Reporta ao fundador

Mensagem curta (5-10 linhas):

- Lista dos slot IDs criados, com 1 linha de objetivo cada.
- Grafo de dependencias (texto simples: "F1-S03 → F1-S04 → F1-S08").
- Quais slots ja estao `available` (deps satisfeitos) e podem ser pegos imediatamente.
- Quais precisam de slots anteriores fecharem.
- Proximo passo: "rode `/hm-engineer` ou peca pro orchestrator implementar o primeiro slot".

## Anti-padroes

- **Slot vago:** "Implementar auth" — quebre em sub-slots.
- **`files_allowed` ausente ou amplo demais:** sem isolamento, agentes paralelos colidem.
- **DoD sem comandos verificaveis:** "ficar bom" nao e DoD. "pnpm test verde" e DoD.
- **Slot sem `source_docs`:** se nao tem origem documentada, voce esta inventando — pare e pergunte.
- **Numero de slots inflado:** se voce criou 20 slots para uma feature de 1 semana, voce quebrou demais. Mire em 3-7 slots por feature media.
- **Dependencias circulares:** A depende de B, B depende de A. Repense a fronteira.
- **Editar `tasks/STATUS.md` a mao:** sempre via `slot.py sync`.

## Padroes

- Cada slot vira um PR. Se o slot e grande demais para um PR revisavel (>500 linhas de diff util), quebre.
- Slots de schema **sempre** vem antes de slots que consomem o schema.
- Slots de frontend que dependem de API podem ser paralelos ao backend **se** o contrato (Zod schema/OpenAPI) e definido em slot anterior.
- Testes ficam **junto** do slot que implementa, nao em slot separado (a menos que seja slot dedicado de cobertura).

## Output

Apos `/hm-tasks`, o fundador deve ter:

1. N slots novos em `tasks/slots/F<n>/`, cada um com frontmatter + corpo completos.
2. `tasks/STATUS.md` atualizado refletindo os novos slots.
3. Grafo de dependencias claro — sabe-se o que pegar primeiro.
4. Cada slot pronto para o orchestrator delegar ao especialista correto via `python scripts/slot.py plan-batch`.

## Regras

- Nao implemente nada. Esta skill **so cria slots**. Implementacao e responsabilidade do orchestrator + engineers.
- Nao crie slots com escopo aberto. Se nao consegue listar `files_allowed`, voce nao entendeu o suficiente — pergunte ou leia mais codigo.
- Nao invente fases novas sem necessidade. Acrescente em fases existentes quando possivel.
- Nao crie slot duplicado. Verifique slots existentes antes de propor um novo.
- Se a feature inteira nao cabe em 1 fase, ok criar slots em multiplas fases — mas seja explicito sobre qual feature isso e e qual o objetivo macro.
