---
id: F43-S02
title: Engine de Niche Blueprint — tipo declarativo + instanciador idempotente
phase: F43
status: blocked
priority: critical
estimated_size: M
depends_on: [F43-S01]
blocks: [F43-S03, F43-S04]
agent_id: backend-engineer
source_docs:
  - docs/features/ONBOARDING.md
---

# F43-S02 — Engine de Niche Blueprint

> **source_docs:** `docs/features/ONBOARDING.md` §2.1, §2.2
> **depends_on:** F43-S01 (precisa de `quick_replies` + repos)
> **blocks:** F43-S03 (conteúdo), F43-S04 (API)

## Objetivo

Definir o tipo declarativo `NicheBlueprint` e o instanciador único
`instantiateNicheBlueprint(tx, workspaceId, blueprint)` — idempotente e RLS-safe — que
aplica TODOS os recursos de um nicho (pipeline, agente(s), tags, tipos de conversão,
departamentos, respostas rápidas, flows) num workspace.

## Contexto

Hoje só há `instantiatePipelineTemplate` (pipeline+agente). Este slot generaliza para o
pacote completo, mantendo o padrão de idempotência ancorado em UNIQUE.

## Escopo (faz)

- `packages/db/src/seed/niches/types.ts`: interfaces `NicheBlueprint` e sub-tipos (§2.1).
- `packages/db/src/seed/niches/instantiate.ts`: `instantiateNicheBlueprint(tx, workspaceId, blueprint)`:
  - pipeline + stages + custom_fields (reaproveita a mecânica de `pipeline_templates.ts`);
  - agente(s) a partir de `agent_templates` (padrão da rota onboarding atual);
  - tags, conversionTypes, departments, quickReplies (insert idempotente por UNIQUE);
  - flows (cria + publica via o publisher/serviço de flows existente, se aplicável; senão cria como rascunho);
  - grava `workspaces.industry` com `blueprint.industry`.
  - Retorna um resumo `{ pipelineId, agentIds, createdCounts }`.
- Recebe um `tx` (transação RLS-scoped) — **não** abre conexão própria nem roda como OWNER.
- Testes unit/integration: dupla-aplicação não duplica nenhum recurso.

## Fora de escopo

- Conteúdo dos 7 nichos e o registry (F43-S03). Endpoint HTTP (F43-S04).

## Arquivos permitidos

- `packages/db/src/seed/niches/types.ts`
- `packages/db/src/seed/niches/instantiate.ts`
- `packages/db/src/seed/niches/instantiate.test.ts`

## Arquivos proibidos

- `packages/db/src/seed/niches/index.ts` (registry — F43-S03)
- `packages/db/src/seed/pipeline_templates.ts`, `seed/agent_templates_niche.ts` (F43-S03)
- `apps/**`

## Contratos de saída

- `NicheBlueprint` type + `instantiateNicheBlueprint(tx, workspaceId, blueprint): Promise<InstantiateResult>`.

## Definition of Done

- [ ] Instanciador aplica todos os tipos de recurso do blueprint numa transação.
- [ ] **Idempotência testada**: aplicar 2x o mesmo blueprint não duplica (asserção por contagem).
- [ ] Roda dentro de tx scoped (sem bypass de RLS).
- [ ] `pnpm --filter @hm/db test` + typecheck + lint verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **backend-engineer**. Idempotência multi-recurso é o risco-chave da fase.
- Instanciador recebe o objeto `NicheBlueprint` (resolução key→blueprint é responsabilidade do caller/registry de S03) — mantém este slot independente do conteúdo.
