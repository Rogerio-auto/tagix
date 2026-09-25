---
id: F70-S10
title: Agentes recebem as tools (transfer_to_human, base de conhecimento e workflow)
phase: F70
status: done
priority: critical
estimated_size: M
depends_on: [F70-S08]
blocks: [F70-S06]
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
  - tasks/COMMS.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:13:46Z
completed_at: 2026-09-25T04:44:14Z

---
# F70-S10 — Agentes recebem as tools

## Objetivo

Todo agente de IA do Leadium poder chamar as tools habilitadas para ele, a começar por `transfer_to_human` e `search_knowledge_base`. Sem isso, o handoff da Arcada (F70-S06) não funciona, nem o de qualquer outro agente.

## Contexto

Achado da F70-S06 (registrado em `tasks/COMMS.md`): `buildRunRequest` em `apps/workers/src/agents/run.ts` não envia `tools` no `POST /run`; o runtime usa `req.tools` (default `[]`). O catálogo `tools` só tem as tools de calendar; as de workflow/KB não existem na tabela. Os handlers do lado da API já existem (`apps/api/src/internal/tools/`).

## Escopo

### files_allowed

- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/run.test.ts`
- `apps/workers/src/agents/tools*.ts`
- `packages/db/src/seed/tools*.ts`
- `packages/db/src/seed/calendar_tools.ts`
- `packages/db/drizzle/**`
- `apps/agent-runtime/**` *(só se o contrato de `ToolDescriptor` exigir ajuste)*

## Escopo (faz)

- Semear no catálogo `tools` as tools que já têm handler na API (workflow, KB e database), idempotente e com migração de dados se o padrão do repo for esse.
- Worker: carregar `agent_tools` habilitadas do agente → `ToolDescriptor[]` no request do runtime.
- Teste de ponta a ponta: agente com `transfer_to_human` habilitada recebe a tool, chama e a conversa vai para humano.

## Entregue

- **Catálogo** (`packages/db/src/seed/tools_agent.ts` + migration `0084_f70_agent_tools_catalog.sql`,
  gerada do TS): 11 tools globais com executor — workflow (`transfer_to_human`, `transfer_to_agent`,
  `escalate`, `mark_resolved`, `change_conversation_status`, `register_conversion`, `move_deal_stage`;
  callback Node), knowledge (`search_knowledge_base`) e database (`query_contact`, `query_deal`,
  `query_conversation`; runtime com ACL de coluna espelhando o `default_handler_config`). A migration
  só insere o que falta e não liga nada em `agent_tools`; `seedAgentTools` (chamado ao fim de
  `seedCalendarTools`, logo pelo `db:seed`/`seed:owner`) sincroniza nome/descrição/schema/config.
  `tools_agent.test.ts` trava: cada tool existe no runtime com a mesma categoria, as de workflow têm
  handler registrado na API, e a 0084 é exatamente o SQL gerado.
- **Worker** (`apps/workers/src/agents/tools.ts` + `run.ts`): `DbAgentRunStore.loadTools` lê sob RLS
  `agent_tools` habilitadas ⋈ `tools` ativas (globais ou do workspace; custom sobrepõe global de mesma
  key), `config = deepMerge(handler_config, overrides)`, valida cada uma no `ToolDescriptorSchema`
  (linha inválida é descartada com `warn`) → `runAgent` aplica o mesmo filtro de policy do runtime
  (`filter_tools`: categorias + teto) → `buildRunRequest` envia `tools` e `contact_id` (da conversa).
  `loadTools` é opcional na porta: store sem ele roda sem tools (fakes antigos intactos).
- **Runtime** (`app/nodes/tool_dispatch.py`): o `ctx` do dispatch passa a levar `contact_id`. Sem isso
  `query_contact`/`query_deal` sempre respondiam "sem contato" mesmo recebendo a tool.

## Validação

Executado em 25/09 contra o Postgres dev (`localhost:5442`), com a 0084 aplicada (`pnpm --filter @hm/db migrate`).

- `tools_agent.test.ts`: 6/6. `run.test.ts`: 9/9 (7 puros + 2 de banco: o request capturado do
  `runAgent` real traz só `search_knowledge_base` e `transfer_to_human`; `escalate` desligada, tool
  inativa e tool custom de outro workspace ficam de fora; `contact_id` = contato da conversa).
  Regressão `agents.test.ts` + `followup.test.ts`: 20/20. Runtime: `pytest` completo 244/244.
- Ponta a ponta no dev (script temporário, não commitado): `runAgent` real → runtime emulado que chama
  `POST /internal/tools/transfer_to_human` por HTTP exatamente como o `CallbackTool` (Bearer + envelope)
  → router interno real da API com `buildWorkflowRegistry`. Resultado: HTTP 200, conversa
  `ai_mode='off'`/`status='pending'`, 1 linha em `tool_logs` (`action=transfer_to_human`). O runtime
  Python não subiu (o LLM é a única peça emulada).
- Seed da Arcada re-rodado no workspace `dev`: vincula `transfer_to_human`, `search_knowledge_base`,
  `query_contact`; `add_contact_tag`/`update_contact` seguem ausentes (sem handler em lugar nenhum). O
  agente Arcada receberia as 3 com a policy do dev.

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/db exec vitest run src/seed/tools_agent.test.ts --maxWorkers=2
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents/run.test.ts src/agents/agents.test.ts --maxWorkers=2
pnpm exec eslint apps/workers/src/agents/run.ts apps/workers/src/agents/tools.ts apps/workers/src/agents/run.test.ts packages/db/src/seed/tools_agent.ts packages/db/src/seed/tools_agent.test.ts packages/db/src/seed/calendar_tools.ts
python -m uv --directory apps/agent-runtime run --frozen pytest tests/test_graph.py tests/test_tools_workflow.py -q
python -m uv --directory apps/agent-runtime run --frozen ruff check app/nodes/tool_dispatch.py tests/test_graph.py
```

## Pendências fora da fronteira

- `add_contact_tag` e `update_contact` (pedidas pela Arcada e por 2 templates) não têm handler nem
  classe no runtime: sem elas a etiqueta `atendimento-humano` (pausa da cadência) continua manual.
- O endpoint interno `POST /internal/tools/:key` não confere se a tool está habilitada para o agente
  (`agent_tools`); a barreira hoje é só o request. Defesa em profundidade: checar no router.
- `writeToolLog` resolve `tools.id` por `key` sem filtrar global/workspace (`tools` não tem RLS): com
  tool custom de mesma key noutro workspace, o log pode apontar para a linha errada.
- `tool_logs.execution_id` recebe o id gerado pelo runtime, não o `agent_executions.id` do worker.
- O runtime ignora `ToolDescriptor.config` (as tools `database` usam o `default_handler_config`
  da classe): `agent_tools.overrides` ainda não tem efeito no runtime.

## Definition of Done

- [x] request do runtime com as tools habilitadas (teste)
- [x] `transfer_to_human` chamada de ponta a ponta no ambiente dev
- [x] seed da Arcada re-rodado vincula as tools
