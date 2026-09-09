---
id: F59-S07
title: Valores personalizados por workspace
phase: F59
status: blocked
priority: high
estimated_size: M
depends_on: [F59-S02]
blocks: []
source_docs:
  - docs/features/AGENCIA_PLAN.md
  - docs/research/2026-09-08-modelo-agencia-local.md
---

# F59-S07 — Valores personalizados por workspace

## Objetivo

Permitir que flows, prompts de agente, campanhas e e-mails referenciem `{{nome_empresa}}`,
`{{link_review}}`, `{{endereco}}`, `{{meta_dataset_id}}` — resolvidos por workspace — para que
trocar de cliente seja editar N variáveis num lugar em vez de caçar a mesma string em cinco
automações.

## Contexto

`AGENCIA_PLAN` §3.4 chama isto de "a peça isolada de maior retorno sobre esforço do plano inteiro":
é o pré-requisito do template de workspace e a diferença entre onboarding de meio dia e de uma semana.

## Escopo

### files_allowed

- `packages/db/src/schema/custom_values.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repositories/custom-values.ts`
- `packages/db/drizzle/0071_f59_workspace_custom_values.sql`
- `packages/db/drizzle/meta/**`
- `apps/api/src/routes/workspace/custom-values/**`
- `apps/api/src/services/custom-values/**`
- `packages/db/src/**/custom-values*.test.ts`

### files_forbidden

- `apps/workers/**`
- `packages/flow-engine/**`

## Escopo (faz)

- `workspace_custom_values` — `workspace_id`, `key` (slug, único por workspace), `label`, `value`,
  `kind` (`text|url|secret`), `description`. RLS no mesmo PR.
- `kind: 'secret'` (ex.: `{{capi_token}}`) é **cifrado em repouso** reusando o AES-256-GCM já
  existente, e **nunca** volta em leitura de API — só a existência e o `label`.
- Resolver `resolveCustomValues(text, workspaceId)`: substitui `{{key}}`, deixa desconhecido intacto
  e devolve a lista de chaves não resolvidas.
- CRUD sob permissão de admin do workspace.

## Fora de escopo

- Consumir o resolver no flow-engine, nos prompts e nas campanhas (slot próprio por consumidor —
  cada um tem seu ponto de renderização e seu teste).
- Template de workspace (F67).

## Definition of Done

- [ ] RLS testada: workspace A não lê valor de B.
- [ ] `kind: 'secret'` cifrado em repouso; teste confirma que a leitura de API devolve `hasValue: true` e nunca o valor.
- [ ] Resolver deixa `{{desconhecido}}` **intacto** e reporta — apagar silenciosamente produz mensagem quebrada que ninguém percebe.
- [ ] Resolver não é recursivo: valor que contém `{{outra}}` não expande. Documentado e testado (evita laço e injeção).
- [ ] `key` validada como slug (`^[a-z][a-z0-9_]{1,48}$`), rejeitando espaço e maiúscula.
- [ ] Auditoria: alteração de valor entra em `audit_logs`.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
```

## Notas

- Não-recursivo é decisão de segurança, não simplificação: expansão recursiva com valor controlado
  pelo usuário é caminho de injeção em prompt de agente.
