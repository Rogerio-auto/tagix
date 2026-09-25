'use client';

/**
 * Expiração de sessão no RUNTIME do cliente (F46-S01, refeito na F70-S28).
 *
 * Handler central de 401: quando a sessão morre com o app aberto, ou quando o app
 * abre com um cookie que já morreu e o middleware não pôde confirmar, purga TUDO e
 * leva ao login com "Sua sessão terminou. Entre de novo.". O middleware cobre a
 * carga do documento; isto cobre o resto (cliques client-side, socket, chamadas em
 * segundo plano).
 *
 * ## O que mudou na F70-S28, e por quê
 *
 * O guard antigo era `useAuthStore.auth !== null`: "só desloga quem estava logado".
 * Quem ABRE o app com cookie morto nunca chega a ter `auth` — o `/api/me` da
 * hidratação já volta 401 —, então o handler nunca disparava e o shell ficava vazio
 * para sempre. No PWA, sem barra de endereço, não havia como chegar ao login.
 *
 * O guard agora é a ROTA: 401 de sessão numa tela protegida → login. Numa tela
 * pública (`/login`, `/signup`…) nada acontece, e é isso que impede o laço
 * login → 401 → login, não o estado do store.
 *
 * Regras:
 *  - **403 nunca desloga** (é "sem permissão", não "sessão expirou").
 *  - 401 com código de NEGÓCIO (ex.: `invalid_current_password` ao trocar a senha)
 *    não é sessão morta — errar a senha atual não pode deslogar ninguém.
 *  - Idempotente: vários 401 simultâneos → UM único redirect (sem flicker/laço).
 *  - `next` validado pelo `safeNextPath` (sem open redirect, T11).
 */
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api-client';
import { isPublicPath } from '@/shared/lib/public-routes';
import { useAuthStore } from '@/shared/stores/auth.store';
import { loginUrl } from './route-guard';

/** 401s que o backend usa para erro de NEGÓCIO, não de sessão. */
const NON_SESSION_401_CODES: ReadonlySet<string> = new Set(['invalid_current_password']);

/** Trava de idempotência: um único redirect por ciclo de vida do documento. */
let redirecting = false;

/** Reset da trava — uso EXCLUSIVO de teste. */
export function __resetSessionExpiryForTest(): void {
  redirecting = false;
}

/** Caminho atual, ou `null` fora do navegador. */
function currentPath(): string | null {
  return typeof window === 'undefined' ? null : window.location.pathname;
}

/**
 * Decide se um erro é "a sessão terminou". PURO em relação a efeitos: `true` só
 * para 401 de sessão (sem código de negócio) numa tela protegida.
 */
export function shouldExpireOn(error: unknown, pathname: string | null = currentPath()): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  if (error.code !== undefined && NON_SESSION_401_CODES.has(error.code)) return false;
  if (pathname === null || isPublicPath(pathname)) return false;
  return true;
}

/**
 * Purga o cliente e redireciona para `/login?next=<rota atual>&motivo=sessao-expirada`.
 * Idempotente e SSR-safe. Desconecta o socket (evita reconectar com cookie morto
 * antes do unload). `queryClient` é opcional: o socket pode disparar isto antes de
 * existir cache para limpar.
 */
export function handleSessionExpired(queryClient: QueryClient | null = null): void {
  if (redirecting || typeof window === 'undefined') return;
  if (isPublicPath(window.location.pathname)) return;
  redirecting = true;

  // 1) Zera a auth (status → unauthenticated): o gating de UI falha fechado.
  useAuthStore.getState().setAuth(null);

  // 2) Derruba o socket. O global é tipado como `ConversationSocket` (on/off); a
  //    instância real é o socket.io client (tem `disconnect()`). Best-effort.
  const sock = window.__hmSocket as { disconnect?: () => void } | undefined;
  try {
    sock?.disconnect?.();
  } catch {
    // Socket já caiu — irrelevante; vamos recarregar a página de qualquer forma.
  }

  // 3) Limpa TODOS os caches de query/mutation (nada de dado de outra sessão).
  queryClient?.clear();

  // 4) Navegação de DOCUMENTO (não `router.push`): reinicia todo o estado em memória.
  //    O cookie morto (httpOnly, inalcançável daqui) é substituído pelo novo no login.
  const here = window.location.pathname + window.location.search;
  window.location.assign(loginUrl(here, true));
}

/**
 * Reage a um erro de API: se for sessão morta, purga + redireciona. Plugado no
 * cliente HTTP (`setUnauthorizedListener`) pelo `makeQueryClient`.
 */
export function onApiErrorMaybeExpire(error: unknown, queryClient: QueryClient | null): void {
  if (shouldExpireOn(error)) handleSessionExpired(queryClient);
}
