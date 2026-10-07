/**
 * Revalidação periódica da sessão do socket (F71 — F-03).
 *
 * O handshake autentica UMA vez. Sem revalidação, um membro bloqueado/removido (ou com a
 * sessão encerrada) continuaria recebendo os eventos da empresa até o socket cair por
 * conta própria. Este módulo é independente de rota: cada socket carrega um timer que
 * re-resolve a sessão do handshake (mesmo token + cookie de empresa preferida) e derruba
 * o socket se a membership/sessão não valer mais.
 *
 * Política (fail-open só em indisponibilidade de infra):
 *  - `ok` e MESMO membro → mantém;
 *  - `ok` com OUTRO membro (a empresa do handshake deixou de ser ativa para esta pessoa e a
 *    resolução caiu em outra) → derruba: as rooms do socket são da empresa antiga;
 *  - `invalid` (token expirado/revogado, nenhuma membership `active`) → derruba;
 *  - `unavailable` ou exceção (provider/banco fora) → mantém e tenta no próximo tick: não
 *    derrubamos o tempo real da empresa inteira por instabilidade de infra.
 *
 * Complemento imediato: ao bloquear/remover um membro, as rotas chamam
 * `disconnectMemberSockets(memberId)` (ver `member-disconnect.ts`); o timer cobre os
 * demais caminhos (sessão revogada no provider, banco alterado fora da API).
 */
import type { SessionContext, SessionResolution } from '../auth';

/** Intervalo da revalidação (60 s). */
export const SOCKET_REVALIDATE_INTERVAL_MS = 60_000;

export type SocketSessionVerdict = 'valid' | 'revoked' | 'unavailable';

/** Decide se a sessão original do handshake ainda vale. Pura em relação ao `resolve`. */
export async function checkSocketSession(
  session: SessionContext,
  cookieHeader: string | undefined,
  resolve: (cookieHeader: string | undefined) => Promise<SessionResolution>,
): Promise<SocketSessionVerdict> {
  let result: SessionResolution;
  try {
    result = await resolve(cookieHeader);
  } catch {
    return 'unavailable';
  }
  if (result.kind === 'unavailable') return 'unavailable';
  if (result.kind === 'invalid') return 'revoked';
  return result.session.member.id === session.member.id ? 'valid' : 'revoked';
}

/** Subconjunto do socket que o revalidador usa. */
export interface RevalidatableSocket {
  on(event: 'disconnect', listener: () => void): unknown;
  disconnect(close?: boolean): unknown;
}

export interface RevalidationOptions {
  readonly session: SessionContext;
  readonly cookieHeader: string | undefined;
  readonly resolve: (cookieHeader: string | undefined) => Promise<SessionResolution>;
  readonly intervalMs?: number;
  readonly onRevoked?: () => void;
}

/**
 * Arma o timer de revalidação para um socket. `unref` (não segura o processo), sem
 * sobreposição de checagens e limpo no `disconnect`. Retorna o `stop` (idempotente).
 */
export function startSocketRevalidation(
  socket: RevalidatableSocket,
  options: RevalidationOptions,
): () => void {
  const { session, cookieHeader, resolve, onRevoked } = options;
  let running = false;
  let stopped = false;

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    void checkSocketSession(session, cookieHeader, resolve)
      .then((verdict) => {
        if (verdict === 'revoked' && !stopped) {
          stop();
          onRevoked?.();
          socket.disconnect(true);
        }
      })
      .finally(() => {
        running = false;
      });
  }, options.intervalMs ?? SOCKET_REVALIDATE_INTERVAL_MS);
  timer.unref();

  function stop(): void {
    stopped = true;
    clearInterval(timer);
  }

  socket.on('disconnect', stop);
  return stop;
}
