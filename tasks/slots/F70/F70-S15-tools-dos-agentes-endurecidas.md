---
id: F70-S15
title: Tools dos agentes — endpoint confere habilitação, log correto e tools de contato
phase: F70
status: in-progress
priority: high
estimated_size: M
depends_on: [F70-S10]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S10-agentes-recebem-as-tools.md
agent_id: backend-engineer
claimed_at: 2026-09-25T05:19:21Z

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

## Definition of Done

- [ ] teste: tool não habilitada → 403, nada executado, log de recusa
- [ ] teste: tool custom de outro workspace com a mesma key não é usada nem logada
- [ ] teste: `add_contact_tag` aplica a etiqueta; `update_contact` recusa campo fora da allowlist
- [ ] teste: override de config chega à tool no runtime; allowlist de colunas não amplia
