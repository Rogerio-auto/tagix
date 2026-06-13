---
id: F26-S05
title: Impersonation API + middleware — view-as READ-ONLY (time-boxed, auditado, no-secrets)
phase: F26
status: blocked
priority: high
estimated_size: M
depends_on: [F26-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/features/PERMISSIONS.md
---

# F26-S05 — Impersonation API + middleware (view-as read-only)

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §6
> **blocks:** F26-S09

## Objetivo

Backend do **view-as READ-ONLY**: o super-admin abre uma sessão de impersonation de um workspace e passa a ver o produto pelos olhos do tenant, **sem poder escrever**. Inclui API de start/end/list de sessão + um **middleware de impersonation** que resolve a sessão → `workspaceId` alvo para o `withWorkspace`, **bloqueando qualquer rota não-GET** (403) enquanto impersonando, e nunca dando acesso a rotas de plataforma nem a secrets. Tudo time-boxed e auditado (LGPD).

## Contexto

`impersonation_sessions` vem do F26-S01 (mode só `view` nesta fase). Decisão travada: **read-only apenas** — sem act-as/escrita. O claim de impersonation é separado da sessão normal; ao encerrar/expirar, volta ao normal.

## Escopo (faz)

- `apps/api/src/routes/platform/impersonation.ts` (novo, gated `requirePlatformAdmin`): `POST /platform/impersonation` (`{ workspaceId, reason }` → cria sessão view, TTL, retorna claim/cookie escopado), `DELETE /platform/impersonation/:id` (encerra), `GET /platform/impersonation` (sessões ativas). Início/fim → `audit_logs`.
- `apps/api/src/middlewares/impersonation.ts` (novo): se há claim de impersonation válido (não expirado), resolve `workspaceId` alvo p/ o contexto de request E **bloqueia métodos não-GET (403)**; nega acesso a `routes/platform/*` e a qualquer rota de secret durante impersonation. Sem claim → no-op.
- Teste: view-as lê dados do tenant alvo; POST/PUT/DELETE → 403; expiração encerra; nega platform routes; audit gravado.

## Fora de escopo

- act-as/escrita (fase futura). UI/banner (F26-S09). Guard de plataforma (F25-S01).

## Arquivos permitidos

- `apps/api/src/routes/platform/impersonation.ts`
- `apps/api/src/middlewares/impersonation.ts`
- `apps/api/src/routes/platform/impersonation.test.ts`
- `apps/api/src/middlewares/impersonation.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts` (wire é do orchestrator), `apps/api/src/middlewares/auth.ts`/`platform-admin.ts` (reusar), outros `routes/platform/*`

## Definition of Done

- [ ] Sessão view-as: start (TTL+reason+audit) / end / list; resolve workspace alvo p/ leitura.
- [ ] Middleware **bloqueia toda escrita (não-GET) em 403** durante impersonation; nega platform routes e secrets; sem claim = no-op.
- [ ] Expiração automática encerra a sessão; início/fim e tentativas de escrita logadas.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Permission scope

Só `is_platform_admin` inicia. Operação sensível (acesso a PII do titular — LGPD): `reason` obrigatório, TTL curto, tudo auditado. Ver `docs/features/PERMISSIONS.md` + PLATFORM_TENANT_MANAGEMENT §6.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**; **`/hm-security` no review (F26-S11)**. Exporta `createPlatformImpersonationRouter()` + `impersonationMiddleware` p/ o orchestrator wire (o middleware entra ANTES das rotas de workspace, DEPOIS do authenticate). NUNCA expor secret/token durante view-as.
