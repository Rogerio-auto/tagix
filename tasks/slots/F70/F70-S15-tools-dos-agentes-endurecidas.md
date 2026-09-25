---
id: F70-S15
title: Tools dos agentes — endpoint confere habilitação, log correto e tools de contato
phase: F70
status: done
priority: high
estimated_size: M
depends_on: [F70-S10]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S10-agentes-recebem-as-tools.md
agent_id: backend-engineer
claimed_at: 2026-09-25T05:19:21Z
completed_at: 2026-09-25T06:15:55Z

---
# F70-S15 — Tools dos agentes: endpoint confere habilitação, log correto e tools de contato

## Objetivo

O servidor ser a barreira de quais tools um agente pode executar, o log de execução apontar para a linha certa, e a Arcada conseguir etiquetar o contato (`atendimento-humano`, que pausa a cadência) sem trabalho manual.

## Contexto

Pendências da F70-S10:
- `POST /internal/tools/:key` não confere `agent_tools`: a barreira é só o request enviado ao runtime.
- `writeToolLog` resolve `tools.id` por `key` sem filtrar global/workspace; `tools` não tem RLS.
- `tool_logs.execution_id` recebe o id do runtime, não o `agent_executions.id` do worker.
- O runtime ignora `ToolDescriptor.config`: `agent_tools.overrides` não tem efeito.
- `add_contact_tag` e `update_contact` são pedidas pela Arcada e por 2 templates, mas não têm handler nem classe no runtime.

## Escopo

### files_allowed

- `apps/api/src/internal/tools/**`
- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/tools.ts`
- `apps/workers/src/agents/*.test.ts`
- `apps/agent-runtime/**`
- `packages/db/src/seed/tools_agent.ts`
- `packages/db/src/seed/tools_agent.test.ts`
- `packages/db/drizzle/**` *(só se o catálogo precisar de migração de dados, no número seguinte ao da F70-S12)*

## Escopo (faz)

- Router interno: recusa (403, sem executar) uma tool não habilitada para o agente da execução, ou de outro workspace.
- `writeToolLog`: resolve a tool por (workspace ou global) + key, com a mesma precedência do worker.
- `execution_id`: o worker envia o `agent_executions.id`, e o runtime o repassa no callback.
- Runtime aplica `ToolDescriptor.config` (overrides), com allowlist de colunas das tools `database`, que não pode ser ampliada por override.
- Tools `add_contact_tag` e `update_contact`: handler na API sob RLS, com Zod estrito e campos editáveis em allowlist (sem telefone nem e-mail pelo modelo); classe no runtime; entrada no catálogo.

### Escopo ampliado (auditoria de segurança pré-deploy)

- **H1 (alto, bloqueia deploy) — runtime:** `tool_dispatch` recusa `key ∉ {t.key for t in state["tools"]}` (já depois do `apply_policy` e do gate de handoff), responde `ok:false` ao modelo e loga. Teste em `test_graph.py` cobrindo uma tool `database` e uma `workflow`.
- **H1 — API:** 403 do router para tool não habilitada para `envelope.agentId` (item original).
- **H1 — handlers:** `move_deal_stage` só age em deal do contato ou da conversa do contexto; `register_conversion` ignora o `contact_id` do modelo quando há conversa no contexto. Teste para os dois.
- **M1 (médio) — PII para o LLM:** `custom_fields` no prompt só com allowlist de chaves (config por agente, default vazio) e teto de tamanho; `query_contact` sem `phone`/`email` na leitura padrão, no runtime e no catálogo (migração na 0087).
- **L8:** `writeToolLog` com a precedência workspace/global; `params` com texto livre (`reason`, `note`…) truncado e mascarado.

## Entregue

**Barreira no endpoint interno** (`apps/api/src/internal/tools/access.ts`, `router.ts`):
- `authorizeToolCall` roda ANTES do handler, na mesma transação RLS da ação. Exige, nesta ordem:
  - linha `agent_tools` habilitada ⋈ `tools` ativa com a key, global ou do workspace, com a custom
    vencendo a global. É a mesma resolução do `loadAgentToolRows` do worker. `agent_tools` torto que
    aponte para a tool custom de outro workspace não habilita nada;
  - `agent_executions` com o `execution_id` do envelope, do mesmo agente e da mesma conversa, e
    em `running`.
- Recusa: responde 403 sem chamar o handler. Grava log estruturado (`reason` estável:
  `tool_not_found`/`tool_not_enabled`/`execution_not_found`/`execution_mismatch`/`execution_not_running`).
  Grava também uma linha `tool_logs` com `action='denied'`, sem os args do modelo, e só aponta
  `agent_id`/`conversation_id` visíveis sob a RLS.
- Merge com o fix `16c948b5` da main: a auditoria (execução e recusa) roda DEPOIS do commit, em
  transação própria e best-effort. O warn leva só code/constraint do Postgres.
- `tool_logs.tool_id` = linha resolvida pela barreira (acabou a busca solta por `key`).
- `params` passa por `redactLogArgs`: `reason`/`note`/`resolution`/`message`/`text`/`summary`/
  `comment` saem sem dígitos nem e-mail e com no máximo 120 caracteres (L8).

**`execution_id` de ponta a ponta:**
- O worker (`run.ts`) manda o `agent_executions.id` em `metadata.execution_id`. Motivo: o Zod de
  `@hm/agents-client` descarta campo desconhecido no topo.
- O runtime (`routes/run.py#_execution_id`) adota o id: aceita o campo no topo ou em `metadata`, e
  com UUID inválido ou ausente gera um novo. O mesmo id vai no envelope dos callbacks, em
  `tool_logs` e no upsert do `finalize`, que agora atualiza a linha do worker em vez de criar uma
  segunda.

**Runtime** (`apps/agent-runtime`):
- `tool_dispatch` só despacha key presente em `state["tools"]`. Fora da lista, o modelo recebe
  `ok:false` ("Ferramenta não disponível") e nada executa (H1).
- O `config` do descritor vai em `ctx["tool_config"]`, e o `registry.dispatch` aplica
  `tool.with_config` num clone.
- `DatabaseTool.with_config` usa `clamp_column_config`. O teto é da classe (`max_handler_config`, ou
  o `default_handler_config`) e o override:
  - só escolhe colunas dentro dele;
  - quando omite um modo, cai no default;
  - não troca a tabela;
  - só acrescenta `restricted`/`required`.
- `query_contact`:
  - padrão sem `phone`/`email`. Os dois continuam no teto e podem ser liberados por agente;
  - `custom_fields` projetado para `custom_fields_keys` (default `[]`), só com valores escalares e
    texto cortado em 200.
- `load_context` filtra o `custom_fields` do contato pela `query_contact` habilitada (sem ela, `{}`)
  antes de o contato entrar no state/checkpoint. `build_prompt` corta o bloco `campos:` em 1500
  caracteres (M1).
- Classes `AddContactTagTool` e `UpdateContactTool` são callback Node com `extra="forbid"`.
  `update_contact` envia só os campos informados.

**Tools de contato na API** (`contact-handlers.ts`, registradas em `buildWorkflowRegistry`). O alvo
é sempre o contato da conversa do envelope, nunca um id vindo do modelo.
- `add_contact_tag` só aplica etiqueta que já existe no workspace: nome exato ou, sem diferenciar
  maiúsculas, quando o resultado é único. Não cria etiqueta, e args extras são recusados.
  - Decisão: etiqueta é controle. `atendimento-humano` pausa a cadência, `tag_added` dispara flows
    e o trigger de conversão reage ao INSERT, então o vocabulário é do operador.
  - Mesmo comportamento do nó `add_tag` do flow-engine.
- `update_contact` usa allowlist `.strict()`: `display_name`, `language` (BCP 47), `timezone` (IANA
  validado) e `custom_fields` (merge; até 20 chaves snake_case; valores escalares ≤ 500).
  - Telefone, e-mail, dono, workspace, opt-in/consentimento, documento e endereço são recusados
    sem escrever nada, e a mensagem lista os campos recusados, sem os valores.

**Handlers presos ao contexto** (`workflow-handlers.ts`, H1):
- `move_deal_stage` só move deal com `contact_id` = contato da conversa ou `conversation_id` = a
  conversa. Sem conversa no envelope, recusa.
- `register_conversion` usa o contato da conversa e ignora o `contact_id` dos args. Os args só
  valem sem conversa.
- Bug achado e corrigido: o Node só lia `conversion_type_key`, mas runtime e catálogo mandam
  `type_key`, então toda chamada real caía em "argumentos inválidos". Agora aceita os dois.

**Catálogo** (`tools_agent.ts` + migration **0087** `0087_f70_agent_contact_tools.sql`, gerada do TS):
- insere as globais `add_contact_tag` e `update_contact` (categoria `workflow`);
- reescreve a global `query_contact`: leitura padrão sem telefone/e-mail, `custom_fields_keys: []`
  e descrição nova;
- `AGENT_TOOL_MIGRATIONS` registra o que cada migration insere e reescreve. O teste trava:
  - a 0084 no que ninguém mudou depois;
  - a 0087 exatamente igual ao SQL gerado;
  - cobertura total do catálogo.
- Journal: `when` 1781452848000, depois da 0085 da main. A **0086 fica com a F70-S16**.
- Não apliquei a 0087 no Postgres dev de propósito: aplicada antes da 0086, o migrator do drizzle
  pularia a 0086 (compara por `when`). Os testes usam o `seedAgentTools`, que dá o mesmo conteúdo.

## Validação

Executado em 25/09 contra o Postgres dev (`localhost:5442`), na branch já com a main mesclada (fix `16c948b5`).

- API `src/internal/tools`: 7 arquivos, 49/49. Inclui:
  - `access.integration.test.ts` 11/11: barreira, tools de contato e H1 dos handlers;
  - `router.test.ts` 13/13: 403 sem executar, recusa logada e L8;
  - `workflow-handlers.domain-events.test.ts` 4/4.
- Worker: `run.test.ts` + `agents.test.ts` + `followup.test.ts`, 30/30.
- DB: `tools_agent.test.ts`, 9/9.
- Runtime: 158/158 nos arquivos tocados e vizinhos:
  - `test_tools_hardening.py`: overrides, teto de ACL, `execution_id`, tools de contato, M1;
  - `test_graph.py`: H1 com tool `database` e `workflow` fora da lista;
  - `test_build_prompt.py`: teto do bloco;
  - `test_tools_workflow.py`, `test_tools_registry.py`, `test_load_context.py`,
    `test_access_control.py`, `test_sandbox.py`, `test_tools_callback.py`, `test_handoff_*`,
    `test_tools_calendar.py`, `test_call_model.py`.

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api exec vitest run src/internal/tools --maxWorkers=2
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents/run.test.ts src/agents/agents.test.ts --maxWorkers=2
pnpm --filter @hm/db exec vitest run src/seed/tools_agent.test.ts --maxWorkers=2
python -m uv --directory apps/agent-runtime run --frozen pytest tests/test_tools_hardening.py tests/test_graph.py tests/test_build_prompt.py tests/test_tools_workflow.py tests/test_tools_registry.py tests/test_load_context.py tests/test_access_control.py -q
python -m uv --directory apps/agent-runtime run --frozen ruff check app tests/test_tools_hardening.py tests/test_graph.py tests/test_build_prompt.py
```

## Pendências fora da fronteira

- `execution_id` viaja em `metadata` porque `AgentRunRequestSchema` (`packages/agents-client`) não
  tem o campo. Promovê-lo a campo tipado no contrato. O runtime já aceita no topo.
- `writeDenialLog`/`writeToolLog` não preenchem `tool_logs.contact_id`: as tools de contato
  poderiam gravá-lo.
- `custom_fields_keys` vive na config da `query_contact`, liberada por agente via
  `agent_tools.overrides`. Falta UI para o operador editar isso. Sem `query_contact` habilitada, o
  agente não vê nenhum campo personalizado no prompt.
- `register_conversion` ignora `currency` (o serviço de conversões não recebe moeda).

## Riscos

- Ordem de deploy: API nova + runtime/worker antigos = toda tool callback recusada com
  `execution_not_found`, porque o runtime antigo gera id próprio. API, workers e agent-runtime
  precisam subir juntos.
- A linha de `agent_executions` agora é uma só por turno: o `finalize` do runtime faz upsert na
  linha do worker. Métrica que contava as duas linhas (worker + runtime) passa a ver metade.

## Definition of Done

- [x] teste: tool não habilitada → 403, nada executado, log de recusa
- [x] teste: tool custom de outro workspace com a mesma key não é usada nem logada
- [x] teste: `add_contact_tag` aplica a etiqueta; `update_contact` recusa campo fora da allowlist
- [x] teste: override de config chega à tool no runtime; allowlist de colunas não amplia
- [x] teste (H1 runtime): tool `database` e `workflow` fora de `state["tools"]` não executam (`test_graph.py`)
- [x] teste (H1 handlers): `move_deal_stage` recusa deal de outro contato; `register_conversion` usa o contato da conversa
- [x] teste (M1): `query_contact` sem telefone/e-mail por padrão; `custom_fields` só com chaves liberadas; prompt com teto
- [x] teste (L8): texto livre mascarado e truncado em `tool_logs.params`
