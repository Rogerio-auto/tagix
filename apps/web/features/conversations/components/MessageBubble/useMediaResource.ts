/**
 * Ciclo de vida de uma mídia renderizável na bolha (F52-S07).
 *
 * Três estados explícitos (UX: loading ≠ error; recuperação acionável):
 *  - `pending`  — ainda baixando (mediaUrl null) ou reidratando a signed URL.
 *  - `ready`    — temos uma URL para renderizar.
 *  - `error`    — falha definitiva (worker esgotou tentativas via `message:
 *                 media_failed`, ou a URL quebrou e o refresh também falhou).
 *
 * Auto-recuperação: a `media_url` persistida é uma signed URL com TTL. Ao reabrir
 * uma conversa antiga ela pode ter expirado e o `<img>/<video>/<audio>` dispara
 * `onError`. Antes de declarar falha, tentamos UMA reidratação via
 * `GET /api/conversations/:id/messages/:messageId/refresh-media-url` (F52-S06).
 * Só se o refresh falhar (ou a nova URL também quebrar) é que mostramos erro.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/lib/api-client';

/** Estado público da mídia para a UI escolher o que renderizar. */
export type MediaResourceState = 'pending' | 'ready' | 'error';

/** Estado interno de reidratação da signed URL. */
type RefreshStatus = 'live' | 'refreshing' | 'error';

/** Resposta do endpoint de refresh de signed URL (F52-S06). */
interface RefreshMediaUrlResponse {
  mediaUrl: string;
  expiresAt: string;
}

export interface UseMediaResourceArgs {
  conversationId: string;
  messageId: string;
  /** URL atual vinda do servidor (`null` enquanto o worker ainda baixa). */
  initialUrl: string | null;
  /** Falha definitiva sinalizada pelo socket (`message:media_failed`). */
  failed?: boolean;
}

export interface MediaResource {
  /** URL a renderizar — não-nula apenas quando `state === 'ready'`. */
  readonly url: string | null;
  readonly state: MediaResourceState;
  /** Plugar no `onError` do elemento de mídia: reidrata a URL antes de falhar. */
  onMediaError(): void;
  /** Ação explícita "Tentar novamente" a partir do estado de erro. */
  retry(): void;
}

/**
 * Deriva o estado público a partir das fontes de verdade. PURA e exportada para
 * teste sem React/DOM (harness `node`).
 *
 * Precedência: erro definitivo (refresh falhou OU worker falhou e não há URL) →
 * carregando (reidratando OU sem URL ainda) → pronto.
 */
export function deriveMediaState(args: {
  url: string | null;
  status: RefreshStatus;
  failed: boolean;
}): MediaResourceState {
  if (args.status === 'error') return 'error';
  if (args.failed && args.url === null) return 'error';
  if (args.status === 'refreshing' || args.url === null) return 'pending';
  return 'ready';
}

export function useMediaResource({
  conversationId,
  messageId,
  initialUrl,
  failed = false,
}: UseMediaResourceArgs): MediaResource {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [status, setStatus] = useState<RefreshStatus>('live');
  // Evita loop de refresh: só uma reidratação automática por URL servida.
  const triedRef = useRef(false);

  // O servidor entregou uma nova URL (media_ready invalida → refetch) ou a
  // mensagem mudou: re-sincroniza e zera o estado de erro/refresh.
  useEffect(() => {
    setUrl(initialUrl);
    setStatus('live');
    triedRef.current = false;
  }, [initialUrl, messageId]);

  const refresh = useCallback((): void => {
    setStatus('refreshing');
    void api
      .get<RefreshMediaUrlResponse>(
        `/api/conversations/${conversationId}/messages/${messageId}/refresh-media-url`,
      )
      .then((res) => {
        setUrl(res.mediaUrl);
        setStatus('live');
      })
      .catch(() => {
        setStatus('error');
      });
  }, [conversationId, messageId]);

  const onMediaError = useCallback((): void => {
    // Já reidratamos e a URL nova também quebrou → erro definitivo (sem loop).
    if (triedRef.current) {
      setStatus('error');
      return;
    }
    triedRef.current = true;
    refresh();
  }, [refresh]);

  const retry = useCallback((): void => {
    triedRef.current = true;
    refresh();
  }, [refresh]);

  const state = deriveMediaState({ url, status, failed });
  return {
    url: state === 'ready' ? url : null,
    state,
    onMediaError,
    retry,
  };
}
