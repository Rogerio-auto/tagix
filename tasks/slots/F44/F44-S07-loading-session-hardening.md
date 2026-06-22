---
id: F44-S07
title: Hardening de loading/sessao — splash deterministico, unverified, open-redirect, store fail-closed
phase: F44
status: review
priority: high
estimated_size: M
depends_on: [F44-S04, F44-S05]
blocks: []
agent_id: frontend-engineer
security_review: required
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
claimed_at: 2026-06-22T18:57:46Z
completed_at: 2026-06-22T19:04:22Z

---
# F44-S07 [SEC] — Hardening de loading e sessao

> source_docs: docs/features/SELF_SERVE_SIGNUP.md §3 (T1, T7, T11)
> depends_on: S04, e S05 (conflito em middleware.ts — S07 SEMPRE depois de S05). blocks: nenhum.

## Objetivo

Endurecer a camada de loading/sessao do web: splash deterministico, tratamento de "sessao
valida mas email nao verificado", guard de open-redirect no ?next=, e auth.store fail-closed.

## Escopo (faz)

- apps/web/shared/stores/auth.store.ts: endurecer hydrate para falhar-fechado (qualquer erro
  nao-401 NAO deve deixar a UI num estado ambiguo "logado"; estado de loading explicito;
  distinguir "nao autenticado" de "autenticado mas nao verificado").
- Estado "sessao valida mas email nao verificado" (T7): quando /api/me indica member pending
  (ou a API retorna o estado de nao-verificado), redirecionar para uma tela de "confirme seu
  email" em vez de entrar no app. Coordenar o shape com S04 (/api/me ou /auth/verify status).
- Open-redirect guard (T11): qualquer uso de ?next= no login/redirect passa por uma allowlist
  interna — so paths same-origin que comecam com / e nao // nem com esquema. Helper puro
  testavel (safeNextPath). Aplicar onde o login consome o retorno.
- middleware.ts: somar /verify a PUBLIC_PREFIXES; aplicar o guard de open-redirect no edge se
  o middleware fizer redirect com next. (S05 ja somou /signup — este slot soma /verify; por isso
  S07 vem DEPOIS de S05, mesmo arquivo.)
- Splash deterministico: enquanto hydrate roda, um estado de loading estavel (sem flash de
  conteudo protegido nem flash de login).
- Auditar (grep) o bundle/codigo do web por vazamento de segredo (T1): nenhuma env nao-NEXT_PUBLIC
  referenciada em codigo client; documentar o resultado nas notas do slot.

## Fora de escopo

- Backend (S04). Telas de signup/reset/verify em si (S05/S06).

## Arquivos permitidos

- apps/web/shared/stores/auth.store.ts
- apps/web/shared/lib/api-client.ts
- apps/web/shared/lib/safe-redirect.ts (novo)
- apps/web/shared/lib/safe-redirect.test.ts (novo)
- apps/web/middleware.ts
- apps/web/features/auth/components/LoginForm.tsx

## Arquivos proibidos

- apps/web/app/(auth)/signup/**, verify/**, reset-password/** (S05/S06)
- apps/web/features/auth/queries.ts, schema.ts (S05)
- apps/**/api/**, packages/**

## Definition of Done

- [ ] auth.store hydrate fail-closed; estados loading/unauth/unverified distintos.
- [ ] Sessao valida + email nao verificado roteia para tela de confirmacao, nao entra no app (T7).
- [ ] safeNextPath rejeita //, esquemas (javascript:, http:), e absolutos externos (T11) — testado.
- [ ] /verify em PUBLIC_PREFIXES; guard de redirect aplicado no consumo do ?next=.
- [ ] Splash deterministico (sem flash de conteudo protegido).
- [ ] Auditoria de segredo no client: zero env nao-NEXT_PUBLIC em codigo client (T1) — anotado.
- [ ] pnpm typecheck + pnpm lint + pnpm --filter @hm/web build verdes.

## Validacao

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: frontend-engineer. [SEC] — gate antes do finish: T11 (open-redirect),
  T7 (gate de unverified), T1 (zero segredo no bundle). E2E nao hidrata — validar por build.
