/**
 * Freio das invalidações em tempo real da Home (F72-S04, segurança M2).
 *
 * `dashboard:metric_changed` chega em rajada (uma importação de contatos, um disparo
 * de campanha, um flow em massa): sem freio, cada evento refaria `/home` e `/today`,
 * e uma sala barulhenta viraria uma inundação de leituras pesadas contra a API, uma
 * por aba aberta. Aqui a rajada vira UMA atualização a cada janela, no fim dela
 * (trailing): o último estado sempre chega, só que agrupado.
 *
 * Puro (sem React, sem socket) para ser testado com relógio falso.
 */
import type { QueryKey } from '@tanstack/react-query';

/** O pedaço do `QueryClient` que o freio usa (o teste passa um dublê). */
export interface InvalidatesQueries {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<unknown>;
}

/** Janela do freio. O selo diz "Ao vivo": 3 s ainda é ao vivo para um número de painel. */
export const REALTIME_BATCH_MS = 3_000;

export interface TrailingThrottle {
  /** Agenda a execução para o fim da janela corrente (abre uma se não houver). */
  readonly call: () => void;
  /** Descarta a execução pendente (desmontagem). */
  readonly cancel: () => void;
}

/**
 * No máximo uma execução de `fn` por janela de `waitMs`, sempre no FIM da janela. O
 * primeiro evento abre a janela; os seguintes dentro dela só pegam carona.
 */
export function trailingThrottle(fn: () => void, waitMs: number): TrailingThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call: () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, waitMs);
    },
    cancel: () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}

/** Invalida `keys` no fim de cada janela de `waitMs`, por mais eventos que cheguem. */
export function createInvalidationBatch(
  qc: InvalidatesQueries,
  keys: readonly QueryKey[],
  waitMs: number = REALTIME_BATCH_MS,
): TrailingThrottle {
  return trailingThrottle(() => {
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  }, waitMs);
}
