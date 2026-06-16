---
id: F34-S02
title: Config de departamentos no editor de agente (API + UI)
phase: F34
status: available
priority: high
estimated_size: M
depends_on:
  - F34-S01
blocks:
  - F34-S07
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
agent_id: frontend-engineer
---
# F34-S02 — Config agente↔departamento

## Objetivo

Permitir que o owner defina, na criação/edição de um agente de IA, **quais departamentos ele atende** (N:N) e **em qual departamento ele é o agente de entrada** (`is_default`), via API + UI.

## Contexto

Consome o repo `agent_departments` de S01. O editor de agente vive em `apps/web/features/agents/` (wizard de criação + `detail/ConfigTab.tsx`); o CRUD em `apps/api/src/routes/agents/crud.ts`. Decisão D1: o agente continua com **um único `system_prompt`** — não há prompt por departamento aqui.

## Escopo (faz)

- **API (`apps/api/src/routes/agents/crud.ts`)** — estender create/update do agente para aceitar `departments: { departmentId, isDefault }[]` (opcional); persistir via `setAgentDepartments` (repo S01) na mesma operação. Incluir os departamentos no GET de detalhe do agente.
- **API (`apps/api/src/routes/agents/index.ts`)** — montar sub-rota se necessário (ex.: `GET /agents/:id/departments`); senão, manter no detalhe.
- **API (`apps/api/src/routes/agents/routes.test.ts`)** — cobrir: criar agente com departamentos; trocar departamentos; marcar default; rejeitar 2 defaults no mesmo dept.
- **UI (`apps/web/features/agents/**`)** — no wizard de criação e no `detail/ConfigTab.tsx`: multi-select de departamentos (lista vem da API de org/departamentos já existente) + toggle "agente de entrada" por departamento selecionado. Estado, mutation e feedback (toast) seguindo o padrão das outras configs do agente.

## Fora de escopo

- Resolução em runtime de qual agente engaja (S03).
- Transferência entre agentes (S04/S05/S06).
- Criar/editar departamentos em si (já existe em settings/workspace-org).
- Prompt por departamento (D1 = prompt único).

## Arquivos permitidos

- `apps/api/src/routes/agents/crud.ts`
- `apps/api/src/routes/agents/index.ts`
- `apps/api/src/routes/agents/routes.test.ts`
- `apps/web/features/agents/**`

## Arquivos proibidos

- `apps/web/features/conversations/**` (cockpit é da S04)
- `packages/db/**` (schema/repo é da S01)
- `apps/workers/**`

## Contratos de entrada/saída

- Entrada: repo `setAgentDepartments` / `listDepartmentsForAgent` (S01).
- Saída: payload do agente passa a incluir `departments: { departmentId, isDefault }[]`.

## Definition of Done

- [ ] Criar/editar agente persiste o conjunto de departamentos + default via `setAgentDepartments`.
- [ ] GET de detalhe do agente retorna os departamentos.
- [ ] UI permite selecionar múltiplos departamentos e marcar 1 como entrada; tentativa de 2 defaults no mesmo dept é barrada (UI + API).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes; `pnpm --filter @hm/web build` verde.

## UX considerations

- UX_PRINCIPLES §2: entrada de configuração visível e nomeada (não esconder atrás de ícone-engrenagem sem rótulo) — o seletor de departamentos é uma seção clara no editor.
- UX_PRINCIPLES §2.7: mutation async com estado de loading no botão de salvar.
- DS v2: zero hex hardcoded; tokens semânticos; multi-select e toggles do `@hm/ui`.

## Permission scope

- Configurar agentes é ação de OWNER/ADMIN (gestão de IA). Reusar o gate já existente das rotas `apps/api/src/routes/agents/*` (não introduzir permissão nova aqui). Citar `docs/features/PERMISSIONS.md §2` (gestão de agentes).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas

A lista de departamentos do workspace já tem endpoint (settings/workspace-org / `apps/api/src/routes/org`). Reusar a query existente no web (`features/settings/sections/workspace-org/queries.ts` é referência de shape) — não criar fetch novo de departamentos do zero.
