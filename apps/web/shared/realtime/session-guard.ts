/**
 * Reação do socket a um handshake recusado (F70-S28).
 *
 * ## Por que existe
 *
 * O socket.io-client 4.x, quando o middleware do servidor recusa o handshake
 * (`next(new Error(...))`), faz `destroy()` no socket e NÃO reconecta sozinho
 * (`socket.active === false`). Antes desta slot, o `SocketProvider` só logava o erro:
 * com a sessão morta o app ficava sem tempo real e sem ir ao login, e uma recusa
 * por instabilidade do provider de auth matava o tempo real até um reload.
 *
 * O contrato com a API (`apps/api/src/socket/index.ts`):
 *  - `unauthorized` → a sessão morreu: para tudo e leva ao login. Nunca reconecta
 *    (reconectar com o mesmo cookie só repetiria a recusa — o laço do log de 25/09).
 *  - qualquer outra recusa (ex.: `auth_unavailable`) → temporária: tenta de novo
 *    com backoff exponencial limitado.
 *  - erro de transporte (API fora, rede caiu) → `active` continua `true` e o próprio
 *    socket.io reconecta; aqui não fazemos nada.
 *
 * Lógica pura sobre uma fatia mínima do socket, para ser testada sem rede nem DOM.
 */

/** Mensagem do handshake que significa "sessão morta" (contrato com a API). */
export const HANDSHAKE_UNAUTHORIZED = 'unauthorized';

/** Fatia do socket.io-client que o guard usa. */
export interface GuardedSocket {
  readonly active: boolean;
  connect(): unknown;
  disconnect(): unknown;
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'connect_error', listener: (err: Error) => void): unknown;
  off(event: 'connect', listener: () => void): unknown;
  off(event: 'connect_error', listener: (err: Error) => void): unknown;
}

export interface SessionGuardOptions {
  /** Chamado UMA vez quando o servidor diz que a sessão morreu. */
  readonly onSessionExpired: () => void;
  /** Agenda uma tentativa; devolve o cancelamento (injetável para teste). */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
}

/** Espera antes da tentativa `attempt` (0-based): 2s, 4s, 8s… até 60s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt));
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/**
 * Liga o guard ao socket. Devolve o `dispose` (remove listeners e cancela a
 * tentativa pendente) para o cleanup do efeito.
 */
export function attachSessionGuard(
  socket: GuardedSocket,
  options: SessionGuardOptions,
): () => void {
  const schedule = options.schedule ?? defaultSchedule;
  let attempt = 0;
  let cancelRetry: (() => void) | null = null;
  let expired = false;

  const onConnect = (): void => {
    attempt = 0;
  };

  const onConnectError = (err: Error): void => {
    if (expired) return;
    if (err.message === HANDSHAKE_UNAUTHORIZED) {
      expired = true;
      cancelRetry?.();
      cancelRetry = null;
      socket.disconnect();
      options.onSessionExpired();
      return;
    }
    // `active` ainda true = erro de transporte: o socket.io reconecta sozinho.
    if (socket.active || cancelRetry) return;
    const delay = retryDelayMs(attempt);
    attempt += 1;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      if (!expired) socket.connect();
    }, delay);
  };

  socket.on('connect', onConnect);
  socket.on('connect_error', onConnectError);

  return () => {
    cancelRetry?.();
    cancelRetry = null;
    socket.off('connect', onConnect);
    socket.off('connect_error', onConnectError);
  };
}
