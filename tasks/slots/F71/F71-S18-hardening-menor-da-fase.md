---
id: F71-S18
title: Hardening menor da fase (Origin do socket, rate limit atômico, isenções do guard)
phase: F71
status: available
priority: low
estimated_size: M
depends_on: [F71-S12, F71-S13, F71-S14]
blocks: []
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/security
---
# F71-S18 — Hardening menor

## Objetivo

Fechar o backlog de baixa severidade da auditoria F71 sem mexer em contrato público.

## Contexto

Achados menores da auditoria de segurança de fim de fase (S10), agrupados por baixo risco. `departmentId` do convite e a regra de assinatura em `@hm/shared` já estão na S14 (não repetir).

## Escopo (faz)

- Socket.io: checar `Origin` no upgrade (`allowRequest`) contra a lista de origens permitidas.
- `apps/api/src/middlewares/rate-limit.ts` `hit()`: `INCR` + `EXPIRE` atômicos (script Lua / `EVAL`), sem chave sem TTL se o processo cair entre as duas.
- Teste de contrato que lista as rotas montadas sob os prefixos isentos do `subscription-guard` (`/api/me`, `/api/support`, `/api/push`, `/api/billing`) e falha se surgir rota nova sem constar numa lista revisada.
- `/metrics` público em `api.leadium.com.br`: verificar a infra (proxy) e restringir (rede interna ou auth); registrar o achado; só altera código se couber na API.
- `x-forwarded-for` cru em `apps/api/src/routes/members/me.ts` (sessões): usar o IP resolvido por `trust proxy`.
- `last_owner`: a checagem conta apenas OWNER `active` (OWNER `inactive`/`invited` não conta), com teste.

## Fora de escopo

- Header por aba (S12), reativação de bloqueado e redact (S14).

### files_allowed

- `apps/api/src/socket/index.ts` e teste
- `apps/api/src/middlewares/rate-limit.ts` e teste
- `apps/api/src/middlewares/subscription-guard-routes.test.ts` (novo, contrato)
- `apps/api/src/routes/members/**` e testes
- `apps/api/src/config/**` (só lista de origens, se faltar)
- `docs/runbooks/**` (nota do `/metrics`)

### files_forbidden

- `packages/**`, `apps/web/**`, `apps/api/src/auth/**`

## Definition of Done

- [ ] teste: upgrade com `Origin` não permitido é recusado; permitido conecta
- [ ] teste: `hit()` concorrente sempre deixa TTL definido
- [ ] teste de contrato falha ao adicionar rota nova sob prefixo isento sem revisão
- [ ] `/metrics` externo: resultado da verificação registrado nas Notas
- [ ] teste: `last_owner` ignora OWNER `inactive`/`invited`
- [ ] `x-forwarded-for` não é mais gravado cru

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/middlewares src/socket src/routes/members --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- Ordem: após S12 (socket/handshake), S13 (`members/me.ts`) e S14.
