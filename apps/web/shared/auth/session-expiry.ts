'use client';

/**
 * Expiração de sessão no RUNTIME do cliente (F46-S01).
 *
 * Handler central de 401: quando uma sessão JÁ autenticada recebe 401 (token/sessão
 * morta no meio do uso), purga TUDO e manda para `/login`. Complementa a F44-S07
 * (que endurece o SSR/middleware na navegação) — aqui é o caso em que o app já está
 * aberto e a próxima chamada à API volta 401.
 *
 * Regras (anti-loop / segurança):
 *  - Só age se HAVIA sessão (`auth != null`). 401 pré-sessão/login e 401 de endpoints
 *    gated a anônimo NÃO disparam logout (senão entraria em loop de redirect).
 *  - **403 nunca desloga** (é "sem permissão", não "sessão expirou").
 *  - Idempotente: múltiplos 401 simultâneos → UM único redirect (sem flicker/loop).
 *  - `returnTo` validado pelo `safeNextPath` (sem open-redirect, T11).
 */
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { safeNextPath } from '@/shared/lib/safe-redirect';

/** Trava de idempotência: um único redirect por ciclo de vida do app. */
let redirecting = false;

/** Reset da trava — uso EXCLUSIVO de teste. */
export function __resetSessionExpiryForTest(): void {
  redirecting = false;
}

/**
 * Decide se um erro deve disparar expiração de sessão. PURO (sem efeitos): só
 * `true` para 401 COM sessão ativa. Facilita o teste do guard sem tocar `window`.
 */
export function shouldExpireOn(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  return useAuthStore.getState().auth !== null;
}

/**
 * Purga o cliente e redireciona para `/login?next=<rota atual segura>`. Idempotente
 * e SSR-safe. Desconecta o socket (evita reconectar com cookie morto antes do unload).
 */
export function handleSessionExpired(queryClient: QueryClient): void {
  if (redirecting || typeof window === 'undefined') return;
  redirecting = true;

  // 1) Zera a auth (status → unauthenticated): o gating de UI falha fechado.
  useAuthStore.getState().setAuth(null);

  // 2) Derruba o socket. O global é tipado como `ConversationSocket` (on/off); a
  //    instância real é o socket.io client (tem `disconnect()`). Cast mínimo + best-effort.
  const sock = window.__hmSocket as { disconnect?: () => void } | undefined;
  try {
    sock?.disconnect?.();
  } catch {
    // Socket já caiu — irrelevante; vamos recarregar a página de qualquer forma.
  }

  // 3) Limpa TODOS os caches de query/mutation.
  queryClient.clear();

  // 4) Redireciona com returnTo validado (nunca open-redirect).
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(safeNextPath(here))}`);
}

/**
 * Reage a um erro de query/mutation: se for expiração de sessão (401 com sessão
 * ativa), purga + redireciona. Plugado no `QueryCache`/`MutationCache` onError do
 * QueryClient (ver `shared/lib/query-client.ts`).
 */
export function onApiErrorMaybeExpire(error: unknown, queryClient: QueryClient): void {
  if (shouldExpireOn(error)) handleSessionExpired(queryClient);
}
