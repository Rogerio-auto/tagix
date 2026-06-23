---
id: F43-S04
title: API de onboarding — aplicar blueprint + estado + pesquisa + checklist
phase: F43
status: done
priority: high
estimated_size: M
depends_on: [F43-S01, F43-S02, F43-S03]
blocks: [F43-S05, F43-S06, F43-S07]
agent_id: backend-engineer
source_docs:
  - docs/features/ONBOARDING.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-19T21:55:34Z
completed_at: 2026-06-19T22:09:36Z

---
# F43-S04 — API de onboarding

> **source_docs:** `docs/features/ONBOARDING.md` §2.2, §3, §5; `docs/features/PERMISSIONS.md`
> **depends_on:** F43-S01 (estado/repos), F43-S02 (instanciador), F43-S03 (registry)
> **blocks:** F43-S05, F43-S06, F43-S07

## Objetivo

Expor a API do onboarding: aplicar o blueprint de um nicho ao workspace, ler/gravar o estado
de onboarding, submeter a pesquisa e calcular o status do checklist "Primeiros passos".

## Contexto

Substitui a rota atual `POST /api/onboarding/niche` (só pipeline+agente, em `app.ts:169`)
pelo fluxo completo baseado no blueprint. Router já montado — **não** tocar `app.ts`.

## Escopo (faz)

- `POST /api/onboarding/apply` — body `{ niche }`; resolve `getBlueprint(niche)` (S03) e roda
  `instantiateNicheBlueprint` (S02) dentro de `req.scoped`; grava `workspaces.onboarding.niche_key`
  + `applied_at`. Gated por **`requireRole('workspace.edit')`**.
- `GET /api/onboarding/state` — retorna `{ onboarding, checklist }` do workspace + `tour_state` do membro.
- `PUT /api/onboarding/survey` — persiste a mini-pesquisa em `workspaces.onboarding.survey`.
- `GET /api/onboarding/checklist` — **status derivado do dado real** (canal conectado? agente ativo?
  contatos importados? flow publicado? campanha enviada?), não flags manuais.
- `PUT /api/me/tour-state` — marca tour como visto/dispensado (por membro; sem `workspace.edit`).
- Manter compat: a antiga `/niche` pode delegar para `/apply` ou ser removida (ajustar consumidores).

## Fora de escopo

- UI (F43-S05/S06/S07). Conteúdo de tour (F43-S08).

## Arquivos permitidos

- `apps/api/src/routes/onboarding/**`
- `apps/api/src/routes/onboarding/onboarding.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts` (router já montado)
- `packages/db/**`, `apps/web/**`

## Contratos de saída

- `POST /api/onboarding/apply` → `201 { pipelineId, agentIds, createdCounts }`.
- `GET /api/onboarding/state` → `{ onboarding, checklist, tourState }`.
- `PUT /api/onboarding/survey` → `200`.
- `GET /api/onboarding/checklist` → `{ steps: { key, done, href }[] }`.
- `PUT /api/me/tour-state` → `200`.

## Permission scope

- `apply`/`survey`/state de workspace: **`workspace.edit`** (ADMIN/OWNER) — ação administrativa que
  cria recursos no workspace (ver `docs/features/PERMISSIONS.md §2`; padrão de `routes/audit.ts`).
- `tour-state`: qualquer membro autenticado (escreve só o próprio `members.tour_state`).

## Definition of Done

- [ ] Endpoints implementados com validação Zod em toda input; `unknown` + Zod (zero `any`).
- [ ] `apply` é idempotente (reaplicar não duplica — herda de S02) e gated por `workspace.edit`.
- [ ] Checklist 100% derivado de dado real (teste cobre pelo menos 2 estados).
- [ ] Testes de rota (authz + idempotência + payload inválido) verdes.
- [ ] `pnpm typecheck` + `pnpm lint` + testes da API verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Erros seguem UX §2.11 (o quê/por quê/o que fazer) no shape de erro.
