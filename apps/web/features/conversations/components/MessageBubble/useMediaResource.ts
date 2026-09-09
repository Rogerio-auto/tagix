/**
 * Ciclo de vida de uma mídia renderizável na bolha (F52-S07, F61-S11).
 *
 * Quatro estados explícitos (UX: loading ≠ error ≠ inexistente):
 *  - `pending`      — ainda baixando (mediaUrl null) ou reidratando a signed URL.
 *  - `ready`        — temos uma URL para renderizar.
 *  - `error`        — falha recuperável (worker esgotou tentativas via `message:
 *                     media_failed`, ou a URL quebrou e o refresh também falhou).
 *                     Tentar de novo faz sentido.
 *  - `unavailable`  — o arquivo não existe e não vai existir (F61-S11). Tentar de
 *                     novo não faz sentido, e oferecer o botão seria mentir.
 *
 * **Carregando é uma promessa.** Antes da F61-S11, mídia que nunca foi baixada
 * (`mediaUrl` null, sem job em andamento) caía em `pending` e girava para sempre —
 * em produção eram 561 mensagens, a maioria eco de coexistência do WhatsApp, que
 * não expõe download por design. Girar sem fim é pior que erro: não dá ao usuário
 * nada para fazer, e ele conclui que o produto está quebrado. O backfill da 0075
 * marca essas mensagens com `metadata.mediaUnavailable`.
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
export type MediaResourceState = 'pending' | 'ready' | 'error' | 'unavailable';

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
  /**
   * O arquivo não existe mais na origem (`metadata.mediaUnavailable`, gravado
   * pelo backfill da 0075). Diferente de `failed`: não há o que retentar.
   */
  unavailable?: boolean;
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
 * Precedência, do mais específico ao mais genérico:
 *  1. `unavailable` sem URL — o arquivo não existe; nenhum estado abaixo se aplica.
 *  2. `error` — refresh falhou OU o worker desistiu e não há URL.
 *  3. `pending` — reidratando OU ainda sem URL.
 *  4. `ready`.
 *
 * `unavailable` vem antes de tudo porque é a única informação que fecha a questão:
 * um arquivo que não existe não está carregando nem falhou de forma recuperável.
 * Mas só quando NÃO há URL — se o servidor entregou uma (backfill posterior, mídia
 * reenviada), a URL manda, e a marca velha não pode esconder mídia que voltou.
 */
export function deriveMediaState(args: {
  url: string | null;
  status: RefreshStatus;
  failed: boolean;
  unavailable?: boolean;
}): MediaResourceState {
  if (args.unavailable === true && args.url === null) return 'unavailable';
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
  unavailable = false,
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

  const state = deriveMediaState({ url, status, failed, unavailable });
  return {
    url: state === 'ready' ? url : null,
    state,
    onMediaError,
    retry,
  };
}
