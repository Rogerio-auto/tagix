---
id: F10-S07
title: Security hardening (OWASP) — headers/helmet/CORS + sanitização de erro + audit
phase: F10
status: in-progress
priority: high
estimated_size: M
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S08
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-12T14:12:54Z

---
# F10-S07 — Security hardening (OWASP top 10)

> **source_docs:** `docs/ROADMAP.md` F10-S08
> **blocks:** —

## Objetivo

Endurecer a superfície HTTP da `@hm/api` contra o OWASP top 10: **security headers** (helmet/CSP/HSTS), **CORS allowlist** estrita, **sanitização de erros** (zero stack/detalhe interno vazando em produção), revisão de rate-limit global, e relatório OWASP em `docs/security/` (informado por `/hm-security`).

## Contexto

A API já tem auth (F0/F9), api-key middleware (F9-S02) e RLS no banco. Falta a camada de hardening de borda HTTP e o registro formal da auditoria OWASP. Toca **arquivos de middleware específicos** (não o glob), então roda em paralelo ao F10-S01.

## Escopo (faz)

- `apps/api/src/middlewares/security.ts` (novo): helmet, CSP coerente com o web, HSTS, no-sniff, frame-guard, CORS allowlist por env.
- `apps/api/src/middlewares/error.ts`: garantir que respostas de erro em produção não vazam stack/SQL/detalhe interno (mensagem genérica + correlation id); dev mantém detalhe.
- `docs/security/owasp-audit.md`: checklist OWASP top 10 com status por item + achados e follow-ups (rode `/hm-security` e consolide).

## Fora de escopo

- Fixes que toquem outros módulos (vira follow-up slot dedicado).
- `/metrics` e observability (F10-S01).

## Arquivos permitidos

- `apps/api/src/middlewares/security.ts`
- `apps/api/src/middlewares/error.ts`
- `docs/security/**`

## Arquivos proibidos

- `apps/api/src/middlewares/metrics.ts`, `apps/api/src/middlewares/api-key.ts`, `apps/api/src/middlewares/auth.ts`
- `apps/api/src/app.ts`

## Definition of Done

- [ ] helmet + CSP + HSTS + CORS allowlist por env, configuráveis e seguros por default.
- [ ] Erros de produção sem vazamento de stack/internals; dev preserva detalhe; correlation id presente.
- [ ] `docs/security/owasp-audit.md` com OWASP top 10 endereçado item-a-item; `pnpm audit` sem high/critical (ou documentado).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

Não muda matriz de roles; endurece a borda. CORS allowlist por env. Ver `docs/features/PERMISSIONS.md` para contexto de authz já existente.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**, informado pela skill `/hm-security` (que é read-only — gera achados; o engineer aplica).
- Middleware `security.ts`/`error.ts` montados em `app.ts` pelo orchestrator no merge.
