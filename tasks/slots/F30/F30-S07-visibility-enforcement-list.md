---
id: F30-S07
title: Enforcement de visibilidade na lista de conversas
phase: F30
status: review
priority: critical
estimated_size: M
depends_on: [F30-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-14T15:35:06Z
completed_at: 2026-06-14T15:48:48Z

---
# F30-S07 — Visibility enforcement (scoped list + filtros)

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §1; `PERMISSIONS.md` §2.1/§3.3
> **blocks:** F30-S03

## Objetivo

Fechar o gap de privacidade: `GET /api/conversations` passa a aplicar os **dois eixos** de visibilidade (entre escopos por role+override; entre colegas por peer-privacy), além de aceitar filtros `department`/`team`/`assigned`. Hoje qualquer AGENT vê o workspace inteiro — `PERMISSIONS.md §2.1` é violado.

## Contexto

A list query (`conversations/index.ts`) só filtra status/assigned/provider/search. Este slot aplica o predicado de visibilidade vindo de `buildVisibilityPredicate` (S01) e adiciona os filtros de distribuição. É **slot de segurança** — tem teste de isolamento obrigatório.

## Escopo (faz)

- `apps/api/src/routes/conversations/index.ts` (editar):
  - aplicar `buildVisibilityPredicate({ memberId, role, workspaceId })` (de `@hm/db`) no `where` da list.
  - aceitar filtros novos: `department`, `team`, `assigned` (me/others/<id>); compor com os existentes.
  - incluir o filtro no `filterHash` da cache key (não vazar cache entre membros com escopos diferentes → key passa a conter `memberId`/scope).
- `apps/api/src/routes/conversations/routes.test.ts` (editar) — AGENT só vê conversas dos seus depts + (em peer `private`) só as suas; SUPERVISOR vê depts liderados; ADMIN vê tudo; override por membro concede dept extra.

## Fora de escopo

- Settings de política (S08).
- UI de filtros (S03).
- Auto-assign (S09).

## Arquivos permitidos

- `apps/api/src/routes/conversations/index.ts`
- `apps/api/src/routes/conversations/routes.test.ts`

## Arquivos proibidos

- `state.ts`/`messages.ts`/`routing.ts`; `packages/**` (predicado vem pronto de S01).

## Definition of Done

- [ ] List aplica os 2 eixos de visibilidade; filtros dept/team/assigned funcionam.
- [ ] Cache key isola por escopo do membro (sem vazamento cross-member).
- [ ] Testes de isolamento por role/override/peer passam.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

Enforcement central do `PERMISSIONS.md §2.1` "Ver inbox": AGENT só atribuídas+dept; SUPERVISOR/ADMIN/OWNER amplos; peer-privacy refina dentro do escopo. Defesa server-side (não só UI).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. CUIDADO com a cache: a key atual (`hm:conv:list:{ws}:v{n}:{filterHash}`) é por-workspace — ao escopar por membro, **incluir o escopo na key** ou o primeiro AGENT envenena a lista dos outros. Esse é o erro mais provável aqui.
- Toda a lógica SQL do predicado mora em `buildVisibilityPredicate` (S01); este slot só a aplica e testa.
