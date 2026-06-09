---
id: F0-S06
title: Express 5 server + middlewares + matriz de permissões can() em @hm/shared
phase: F0
status: review
priority: critical
estimated_size: M
depends_on: [F0-S03, F0-S05]
agent_id: backend-engineer
claimed_at: 2026-06-09T20:10:58Z
completed_at: 2026-06-09T20:16:06Z

---
# F0-S06 — Express server + middlewares + permissões

> **source_docs:** `docs/ARCHITECTURE.md` §API; `docs/features/PERMISSIONS.md` §2 (roles), §3.1 (matriz ROLE_CAN)
> **blocks:** F0-S07 (socket auth), features F1+

## Objetivo

Servidor Express 5 com middlewares de segurança e a matriz de permissões tipada (`ROLE_CAN` + `can()`) compartilhada entre backend (`requireRole`) e frontend (esconder UI).

## Escopo (faz)

- `apps/api/src/server.ts` + `app.ts` — Express 5, `helmet`, `cors` (origin via env, nunca `*`), `compression`, body parse, error handler (3-partes + ref), `GET /health` (checa db/redis), monta rotas de auth (F0-S05).
- Middlewares: `requireAuth` (sessão→req.member), `withRLS` (SET app.workspace_id via `@hm/db.withWorkspace`), `requireRole(perm)`.
- `packages/shared/src/permissions.ts` — `Role` (OWNER/ADMIN/SUPERVISOR/AGENT/READONLY — **reconcilia o skeleton**), `Permission`, matriz `ROLE_CAN` tipada e `can(role, perm)`.
- `apps/api/src/index.ts` — bootstrap real (listen 0.0.0.0:port).

## Fora de escopo

- Socket.io (F0-S07). Rotas de features de produto (F1+).

## Arquivos permitidos

- `apps/api/src/**` (exceto `apps/api/src/auth/**`, dono de F0-S05 — pode importar)
- `packages/shared/src/permissions.ts`, `packages/shared/src/index.ts`

## Contratos de saída

- `import { can, ROLE_CAN, type Role, type Permission } from '@hm/shared'` (usado em api e web).
- `GET /api/me`, `GET /health` (com status de dependências).

## Definition of Done

- [ ] Servidor sobe; `GET /health` retorna status de db/redis.
- [ ] `requireAuth` + `withRLS` + `requireRole` aplicáveis em rotas.
- [ ] `can(role, perm)` importável em ambos os lados; `@hm/shared` ROLES reconciliado com o DB.
- [ ] helmet/cors/compression ativos; CORS origin via env.
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Permission scope

- Define a base de permissões de todo o produto (PERMISSIONS.md §3.1).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Reconciliar `@hm/shared` ROLES (skeleton tinha owner/admin/manager/agent/viewer) → OWNER/ADMIN/SUPERVISOR/AGENT/READONLY. Ajustar usos (web auth.store já importa Role).
