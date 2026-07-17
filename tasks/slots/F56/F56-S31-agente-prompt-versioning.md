---
id: F56-S31
title: Agente — versionamento de prompt (draft→live, diff, rollback)
phase: F56
status: done
priority: medium
estimated_size: L
depends_on: [F56-S30]
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T23:51:13Z

---
# F56-S31 — Prompt como código (AG-04)

> **Origem:** AUDITORIA_TECNICA.md §3.3. `system_prompt` é coluna mutável; PATCH sobrescreve in-place — sem histórico, diff, rollback ou auditoria. Edita-se o cérebro de um agente ao vivo sem staging. Gap #1 vs. Fin/Sierra/Decagon.

## Objetivo

Tratar o prompt do agente como código: histórico append-only, publicação explícita draft→live, diff e rollback.

## Contexto / causa raiz (verificada)

`schema/agents.ts:43` (coluna text mutável); `crud.ts:366-396` (PATCH direto sem histórico); grep `agent_versions/rollback` = 0.

## Escopo (faz)

- Tabela `agent_prompt_versions` (append-only: prompt, model, params, author, label, created_at) + RLS + migration `0066_f56_agent_prompt_versions.sql`.
- Rotas `apps/api/src/routes/agents/versions.ts`: list/diff/rollback + publicação draft→live.
- Hook em `crud.ts` (PATCH) para gravar versão a cada mudança de prompt (por isso depende de F56-S30, dono de `crud.ts`).
- UI de versões em `apps/web/features/agents/detail/versions/**` (list + diff + rollback).

## Escopo (não faz)

- Canary por % (follow-up). Eval como gate (Épico 7 separado).

## Arquivos permitidos

- `packages/db/src/schema/agent_prompt_versions.ts`
- `packages/db/drizzle/0066_f56_agent_prompt_versions.sql`
- `apps/api/src/routes/agents/versions.ts`
- `apps/api/src/routes/agents/crud.ts`
- `apps/web/features/agents/detail/versions/**`

## Arquivos proibidos

- `apps/web/features/agents/wizard/**` (F56-S30) · `packages/db/drizzle/meta/**`

## Definition of Done

- [ ] Cada edição de prompt grava uma versão; histórico visível.
- [ ] Diff entre versões + rollback 1-clique funcionam (teste).
- [ ] RLS na nova tabela testada.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

- Editar/publicar/rollback do prompt gated por `agent.edit` (`docs/features/PERMISSIONS.md §2`).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- **Depende de F56-S30** (dono de `crud.ts`): S30 fecha a interpolação de answers; S31 adiciona o hook de versão no mesmo arquivo. `meta/_journal.json` regenerado pelo integrador.
