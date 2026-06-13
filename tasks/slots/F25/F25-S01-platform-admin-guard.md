---
id: F25-S01
title: Platform-admin guard — middleware requirePlatformAdmin (API)
phase: F25
status: available
priority: critical
estimated_size: S
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/features/PERMISSIONS.md
---

# F25-S01 — Platform-admin guard (API)

> **source_docs:** `docs/ROADMAP.md` F2.5-S01; `docs/features/PERMISSIONS.md` (nível plataforma)
> **blocks:** F25-S02, F25-S03, F25-S04, F25-S05
> **F2.5 — Super-admin de IA** (camada plataforma deferida; schema já ready).

## Objetivo

Middleware `requirePlatformAdmin` que protege todas as rotas de plataforma: exige sessão autenticada com `isPlatformAdmin=true` (já exposto em `apps/api/src/auth/session.ts`), respondendo 403 caso contrário, e registra acesso negado em `audit_logs` (actor_type `platform_admin`). Fundação de toda a API de super-admin.

## Contexto

A sessão já carrega `isPlatformAdmin` (members.is_platform_admin). Falta o gate HTTP. A camada plataforma NÃO é workspace-scoped (sem RLS de tenant) — o guard é a única fronteira de acesso; por isso é crítico e vem antes de tudo.

## Escopo (faz)

- `apps/api/src/middlewares/platform-admin.ts` (novo): `requirePlatformAdmin` (reusa o authenticate de sessão existente; 401 sem sessão, 403 sem `isPlatformAdmin`); helper para montar sub-routers de plataforma já gated.
- Teste: nega não-admin (403), permite admin, 401 sem sessão.

## Fora de escopo

- Endpoints de plataforma (F25-S02..S05). Guard de rota no frontend (F25-S06).

## Arquivos permitidos

- `apps/api/src/middlewares/platform-admin.ts`
- `apps/api/src/middlewares/platform-admin.test.ts`

## Arquivos proibidos

- `apps/api/src/middlewares/auth.ts` (reusar, não reescrever), `apps/api/src/app.ts`

## Contratos de entrada/saída

- `requirePlatformAdmin: RequestHandler` — 401 (sem sessão) / 403 (sem isPlatformAdmin) / next() (ok). Exportado para os slots S02-S05 montarem seus routers.

## Definition of Done

- [ ] `requirePlatformAdmin` nega não-admin (403) e sem-sessão (401); permite platform admin; acesso negado vai a `audit_logs`.
- [ ] `pnpm --filter @hm/api test` (guard) + lint/typecheck verdes.

## Permission scope

Nível **plataforma** (acima de workspace) — só `is_platform_admin`. Ver `docs/features/PERMISSIONS.md` (3 níveis: pessoal/workspace/plataforma).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Reusa o `authenticate` de sessão existente; não duplica. Todos os routers de plataforma (S02-S05) usam este guard.
