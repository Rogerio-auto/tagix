---
id: F71-S11
title: Web com headers de segurança reais, Sentry sem token e token_hash fora da query
phase: F71
status: available
priority: high
estimated_size: M
depends_on: [F71-S10]
blocks: [F71-S15]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/runbooks/supabase-auth-emails.md
  - docs/security
---
# F71-S11 — Headers de segurança, scrubbing do Sentry e token_hash no fragmento

## Objetivo

Nenhum segredo de conta (token de convite, `token_hash`, `redirect_to`) vaza por Referer, log de proxy, Sentry ou replay, e o app web responde com headers de segurança de verdade (HTTP), não só `<meta>`.

## Contexto

Auditoria de segurança de fim de fase da F71 (S10): achados F-05 (headers/CSP/Referrer-Policy só por meta ou ausentes) e F-06 (Sentry web captura URL com `/convite/<token>` e `?next=`), mais o `token_hash` de "Reset password" e "Confirm signup" que viaja na query de `/verify` e `/reset-password`. Fonte: `docs/features/CONTAS_E_CONVITES.md` §6 e Notas de execução de S05/S08/S10.

## Escopo (faz)

- `apps/web/next.config.mjs` `headers()`: `Content-Security-Policy` (nonce/hash, sem `unsafe-inline` em script quando viável; connect-src com API, Supabase, Sentry e socket), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (max-age 2 anos, includeSubDomains), `Permissions-Policy` mínima. Aplicar em todas as rotas; CSP em `Report-Only` por um deploy se algo quebrar, registrado.
- Sentry web (`instrumentation-client.ts`, `instrumentation.ts`, `apps/web/shared/lib/sentry/**`): `beforeSend`, `beforeSendTransaction` e `beforeBreadcrumb` mascaram `/convite/<x>` → `/convite/[token]`, `?next=` que contenha convite, `token_hash`, `redirect_to`, `access_token`, `refresh_token`; replay com `maskAllInputs` e URL mascarada. Função pura `scrubUrl` testada.
- `/verify` e `/reset-password` leem `token_hash` e `type` do **fragmento** (`#token_hash=...&type=...`) e limpam a URL com `history.replaceState` antes de qualquer request/render de terceiros.
- Login: `?next=/convite/<token>` deixa de carregar o token na URL; o destino é guardado em estado/cookie curto (`SameSite=Lax`, 10 min) e consumido após o login.
- Runbook `docs/runbooks/supabase-auth-emails.md`: templates "Confirm signup" e "Reset password" passam a usar `{{ .SiteURL }}/verify#token_hash={{ .TokenHash }}&type=signup` (idem reset).
- **Decisão de transição (registrar nas Notas):** a página aceita query **e** fragmento por 14 dias (prefere fragmento e limpa a query com `replaceState`); depois remove a leitura da query. Alternativa descartada: deploy coordenado exato com a troca do template, por exigir janela sincronizada com o painel do Supabase.

## Fora de escopo

- `/verify` que define a senha (S15). Mudança no provider de auth da API.

### files_allowed

- `apps/web/next.config.mjs`, `apps/web/middleware.ts`
- `apps/web/instrumentation-client.ts`, `apps/web/instrumentation.ts`, `apps/web/shared/lib/sentry/**`
- `apps/web/app/(auth)/verify/**`, `apps/web/app/(auth)/reset-password/**`, `apps/web/app/(auth)/login/**`
- `apps/web/features/auth/**` (leitura de fragmento e destino pós-login), `apps/web/shared/lib/safe-redirect.ts` e teste
- `docs/runbooks/supabase-auth-emails.md`
- testes ao lado e `apps/web/e2e/specs/**` (spec nova de headers/fragmento)

### files_forbidden

- `apps/api/**`, `packages/**`
- `apps/web/shared/lib/api-client.ts` (S12)
- `apps/web/features/invites/**` (S13)

## Definition of Done

- [ ] teste e2e: resposta de `/login` e `/convite/x` traz CSP, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, nosniff e HSTS
- [ ] teste unitário: `scrubUrl`/`beforeSend` mascaram convite, `next`, `token_hash`, `redirect_to` em URL, breadcrumbs e transação
- [ ] teste: `/verify#token_hash=...&type=signup` confirma e a URL final não contém o token; query legada ainda funciona e é limpa
- [ ] teste: login com destino de convite não expõe o token na URL
- [ ] sem violação de CSP no console nas telas de auth e no shell (verificado e registrado)
- [ ] runbook atualizado com os dois templates e a data de remoção da query legada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
node --env-file=.env apps/web/node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
pnpm --filter @hm/web build
```

## Notas

- Agente: `frontend-engineer` (coordenar a troca dos templates no painel do Supabase com o Rogério).
- Ordem de deploy: código com leitura dupla → template em fragmento → (14 dias) remover query.
