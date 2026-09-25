---
id: F70-S10
title: Agentes recebem as tools (transfer_to_human, base de conhecimento e workflow)
phase: F70
status: available
priority: critical
estimated_size: M
depends_on: [F70-S08]
blocks: [F70-S06]
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
  - tasks/COMMS.md
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

## Definition of Done

- [ ] request do runtime com as tools habilitadas (teste)
- [ ] `transfer_to_human` chamada de ponta a ponta no ambiente dev
- [ ] seed da Arcada re-rodado vincula as tools
