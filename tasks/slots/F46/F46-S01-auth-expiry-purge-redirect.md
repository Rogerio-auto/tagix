---
id: F46-S01
title: Token expirado → purga caches + desconecta socket + redireciona p/ login
phase: F46
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
---

# F46-S01 — Expiração de sessão no runtime do cliente (401 global → purge + redirect)

> **source_docs:** `docs/features/SELF_SERVE_SIGNUP.md` (F44 — loading/session hardening)
> **Contexto multi-sessão:** criado como item de FILA. NÃO foi rodado `slot.py sync`
> (havia F45 em andamento por outra sessão editando `STATUS.md`). Ao claimar, rode
> `python scripts/slot.py sync` para registrar no board.

## Objetivo

Quando QUALQUER chamada à API responder **401** durante a navegação (token/sessão
expirado ou invalidado), o cliente deve, de forma centralizada e idempotente:
**(1)** limpar TODOS os caches (TanStack Query + auth store + estado client),
**(2)** desconectar o Socket.io, **(3)** redirecionar para `/login` com `returnTo`
(usando o guard de safe-redirect da F44), com feedback honesto ("Sua sessão expirou").

## Contexto

A F44-S07 endureceu o **SSR/middleware** (proteção de rota na navegação, open-redirect
guard, fail-closed). Falta o caso de **runtime**: a sessão expira COM o app já aberto;
a próxima chamada à API volta 401, mas hoje o erro só vira `ApiError` por query — não
há handler global que reaja deslogando. Resultado: telas com dado stale, queries em
loop de 401, e o usuário "preso" sem entender. Este slot fecha esse gap.

## Escopo (faz)

- **Handler global de 401**: detectar `ApiError.status === 401` de forma central —
  via `queryCache`/`mutationCache` `onError` no `QueryClient` (`app/providers.tsx`)
  e/ou um interceptor no `api-client`. Distinguir **401 (expirou → desloga)** de **403
  (sem permissão → NÃO desloga, só nega)**.
- **Purga**: `queryClient.clear()` (todos os caches), limpar `auth.store` (zerar `auth`),
  e qualquer storage de sessão client (ex.: dismiss flags por workspace — opcional).
- **Socket**: desconectar/limpar o `SocketProvider` (`window.__hmSocket` + contexto) no
  expiry, para não reconectar com cookie morto em loop.
- **Redirect idempotente**: redirecionar para `/login?returnTo=<rota atual>` via o
  `safe-redirect` da F44 (nunca open-redirect). Guard de **idempotência**: múltiplos
  401 simultâneos disparam UM único redirect (flag/ref), sem loop nem flicker.
- **Anti-loop**: não tratar como expiry os 401 ESPERADOS de endpoints abertos a
  anônimo / pré-sessão (ex.: o próprio `/auth/*`, ou o `GET /onboarding/state` gated —
  avaliar allowlist de paths que não disparam logout).
- **Feedback**: toast/where-appropriate "Sua sessão expirou, faça login de novo." (UX §2.11).

## Fora de escopo

- Proteção de rota no SSR/middleware (já é F44-S07). Refresh-token silencioso/renovação
  automática de sessão (feature separada, se desejada). Logout manual (já existe).

## Arquivos permitidos

- `apps/web/shared/lib/api-client.ts`
- `apps/web/shared/auth/**` (novo util/hook central de expiry, ex.: `session-expiry.ts`)
- `apps/web/app/providers.tsx` (QueryClient onError global)
- `apps/web/shared/stores/auth.store.ts` (método de purge, se faltar)
- `apps/web/shared/realtime/SocketProvider.tsx` (desconectar no expiry)
- `apps/web/shared/lib/safe-redirect.ts` (reuso; só ler/estender se necessário)

## Arquivos proibidos

- `apps/api/**`, `apps/workers/**`, `packages/**`
- Rotas/telas de feature alheias (conversations/pipeline/etc.) — o handler é global.

## Definition of Done

- [ ] 401 em qualquer query/mutation dispara purge + desconexão de socket + redirect único.
- [ ] 403 NÃO desloga; 401 de endpoints pré-sessão (allowlist) NÃO desloga (sem loop).
- [ ] `returnTo` validado pelo safe-redirect (sem open-redirect); idempotente sob 401 paralelos.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes; teste unit do guard de expiry (idempotência + 401 vs 403 + allowlist).

## UX considerations

- Aplica 2.11 (erro em 3 partes / mensagem honesta: "sessão expirou, faça login").
- Aplica 2.7 (sem click-fantasma: feedback imediato no expiry).
- Sem flicker/loop de redirect (idempotência) — UX de transição limpa.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- **Coordenação multi-sessão:** `providers.tsx`, `auth.store.ts`, `SocketProvider.tsx`
  foram tocados na F44/F45 — claimar quando o working tree estiver livre (ou em worktree
  isolado) para não colidir. Especialista: **frontend-engineer**.
- Alinhar com o `resolveSession`/`verifyTokenResilient` do servidor (F44, `d6c8532`): o
  401 chega quando a sessão realmente morreu (cache stale-on-error já absorve flutuação
  de rede), então o expiry do cliente reage a um 401 "de verdade", não a ruído transitório.
- Reusar `ApiError` (`shared/lib/api-client.ts`) — ela já carrega `status` e `ref`.
