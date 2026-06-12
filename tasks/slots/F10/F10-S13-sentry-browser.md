---
id: F10-S13
title: Sentry browser — error tracking do cliente web (opt-in, no-op sem DSN)
phase: F10
status: available
priority: medium
estimated_size: S
depends_on: []
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S02
  - tasks/slots/F10/F10-S01-observability-stack.md
---

# F10-S13 — Sentry browser (web client error tracking)

> **source_docs:** follow-up do F10-S01 (que cobriu Sentry server-side e deixou o browser como follow-up para não colidir com slots de frontend)
> **blocks:** —

## Objetivo

Fechar a observabilidade do lado do cliente: integrar **Sentry no @hm/web** (Next 15 App Router) capturando erros de runtime do browser, **opt-in** (no-op sem `NEXT_PUBLIC_SENTRY_DSN`), com `global-error.tsx` reportando exceções não tratadas e session/trace sampling configurável.

## Contexto

O F10-S01 ligou Sentry em api/workers/agent-runtime (server-side) e explicitamente deixou o cliente web de fora para não colidir com S04/S05/S06. Agora que a F10 fechou, este slot completa o tripé. Padrão da casa: nada liga sem env.

## Escopo (faz)

- `apps/web/instrumentation-client.ts` (Next 15): init do Sentry browser, opt-in por `NEXT_PUBLIC_SENTRY_DSN` (no-op sem DSN), sampling por env.
- `apps/web/instrumentation.ts` (register server/edge — opcional, opt-in).
- `apps/web/app/global-error.tsx`: error boundary global que reporta ao Sentry e renderiza fallback DS v2 (dark-first, tokens semânticos).
- `apps/web/shared/lib/sentry/**`: helpers (captureException client, wrapper opt-in).
- `apps/web/next.config.mjs`: `withSentryConfig` (source maps opt-in; sem quebrar build quando DSN/dep ausentes — guardar como o analyzer do F10-S06).
- `apps/web/package.json`: dep `@sentry/nextjs`.

## Fora de escopo

- Sentry server-side (F10-S01, já feito) — não reconfigurar.
- Telas/feature components (F10-S10/S12).

## Arquivos permitidos

- `apps/web/instrumentation-client.ts`
- `apps/web/instrumentation.ts`
- `apps/web/app/global-error.tsx`
- `apps/web/shared/lib/sentry/**`
- `apps/web/next.config.mjs`
- `apps/web/package.json`

## Arquivos proibidos

- `apps/web/features/**`, `apps/web/app/(app)/**` (F10-S10/S12)
- Backend / `packages/**`

## Definition of Done

- [ ] Sentry browser opt-in: **no-op sem `NEXT_PUBLIC_SENTRY_DSN`**; com DSN, captura erro de runtime e o `global-error.tsx` reporta.
- [ ] `global-error.tsx` com fallback DS v2 (tokens semânticos, zero hex), botão "tentar de novo" (reset).
- [ ] Build NÃO quebra sem a env nem (idealmente) sem source-map upload token; `withSentryConfig` guardado/condicional.
- [ ] `pnpm --filter @hm/web typecheck` + `lint` + `build` verdes.

## UX considerations

- `global-error.tsx`: estado de erro claro e não-assustador (§2.11 erro-misterioso → mensagem humana + ação de retry), dark-first.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- Env nova: `NEXT_PUBLIC_SENTRY_DSN` (browser; `NEXT_PUBLIC_` porque é client-side), `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` (source maps, opt-in no build). Documentar para `.env.example` (o orchestrator consolida no merge).
- `@sentry/nextjs` é a integração oficial Next 15 (cobre client+server+edge). Manter o init **condicional ao DSN** para não impor overhead em dev/local.
