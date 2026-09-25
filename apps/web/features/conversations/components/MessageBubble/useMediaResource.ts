/**
 * Ciclo de vida de uma mídia renderizável na bolha (F52-S07, F61-S11, F70-S27).
 *
 * Quatro estados explícitos (UX: loading ≠ error ≠ inexistente):
 *  - `pending`      — ainda baixando (mediaUrl null), reidratando a signed URL ou
 *                     aguardando um "tentar de novo" que acabou de ser pedido.
 *  - `ready`        — temos uma URL para renderizar.
 *  - `error`        — falha recuperável: o worker marcou `failed` (motivo em
 *                     `metadata.mediaFailure`, ou o evento `message:media_failed`), a
 *                     mídia passou do prazo sem chegar, ou a URL quebrou e o refresh
 *                     também falhou. Tentar de novo faz sentido.
 *  - `unavailable`  — o arquivo não existe e não vai existir (F61-S11), ou o provedor
 *                     disse que expirou (F70-S27). Oferecer o botão seria mentir.
 *
 * **Carregando é uma promessa.** Em 25/09 o storage recusou a credencial e o chat
 * mostrou "carregando áudio…" para sempre. Agora a espera tem prazo
 * ({@link MEDIA_PENDING_TIMEOUT_MS}): passou dele sem mídia, a bolha diz que não deu.
 *
 * "Tentar de novo" tem dois caminhos:
 *  - com URL (signed URL expirada): reidrata via `refresh-media-url` (F52-S06);
 *  - sem URL (o download ou o storage falhou): pede ao servidor para baixar de novo
 *    (`POST …/retry-media`, F70-S27) — só para quem pode (`canRetryDownload`).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/shared/lib/api-client';

/** Estado público da mídia para a UI escolher o que renderizar. */
export type MediaResourceState = 'pending' | 'ready' | 'error' | 'unavailable';

/**
 * Prazo de uma mídia recebida sem chegar antes de a bolha desistir de "carregando".
 * O download normal leva segundos; dois minutos cobrem as retentativas curtas do
 * worker. Mesmo prazo que a API usa para aceitar o "tentar de novo" de uma pendente.
 */
export const MEDIA_PENDING_TIMEOUT_MS = 2 * 60_000;

/** Motivos em que o arquivo não existe mais na origem (espelha o worker). */
const TERMINAL_REASONS: ReadonlySet<string> = new Set([
  'media_expired',
  'media_unavailable',
  'empty_media',
]);

/** `true` quando o motivo gravado pelo worker diz que o arquivo não volta. */
export function isTerminalFailure(reason: string | null): boolean {
  return reason !== null && TERMINAL_REASONS.has(reason);
}

/** Estado interno de reidratação/reprocessamento. */
type RefreshStatus = 'live' | 'refreshing' | 'error' | 'requeued';

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
  /** `messages.media_status` servido pela API (`pending|downloading|ready|failed`). */
  mediaStatus?: string | null;
  /** `metadata.mediaFailure.reason` gravado pelo worker. */
  failureReason?: string | null;
  /** Criação da mensagem (ISO) — base do prazo de "carregando". */
  createdAt?: string;
  /** Quem vê pode pedir um novo download (mesma permissão de responder). */
  canRetryDownload?: boolean;
}

export interface MediaResource {
  /** URL a renderizar — não-nula apenas quando `state === 'ready'`. */
  readonly url: string | null;
  readonly state: MediaResourceState;
  /** Há ação de "tentar de novo" útil para este estado e este usuário. */
  readonly canRetry: boolean;
  /** Explicação curta vinda do servidor quando o "tentar de novo" foi recusado. */
  readonly retryNotice: string | null;
  /** Plugar no `onError` do elemento de mídia: reidrata a URL antes de falhar. */
  onMediaError(): void;
  /** Ação explícita "Tentar de novo" a partir do estado de erro. */
  retry(): void;
}

/**
 * Deriva o estado público a partir das fontes de verdade. PURA e exportada para
 * teste sem React/DOM (harness `node`).
 *
 * Precedência, do mais específico ao mais genérico:
 *  1. `ready` quando há URL viva — a URL servida prevalece sobre marcas antigas.
 *  2. `unavailable` — o arquivo não existe (marca da 0075 ou motivo terminal).
 *  3. `pending` — reidratando ou "tentar de novo" recém-pedido.
 *  4. `error` — refresh falhou, o worker desistiu, ou o prazo passou sem mídia.
 *  5. `pending`.
 */
export function deriveMediaState(args: {
  url: string | null;
  status: RefreshStatus;
  failed: boolean;
  unavailable?: boolean;
  /** `media_status` do servidor. */
  mediaStatus?: string | null;
  /** `metadata.mediaFailure.reason`. */
  failureReason?: string | null;
  /** O prazo de "carregando" já passou. */
  pendingExpired?: boolean;
}): MediaResourceState {
  const noUrl = args.url === null;
  if (noUrl && (args.unavailable === true || isTerminalFailure(args.failureReason ?? null))) {
    return 'unavailable';
  }
  if (args.status === 'error') return 'error';
  if (args.status === 'refreshing' || args.status === 'requeued') return 'pending';
  if (!noUrl) return 'ready';
  if (args.failed || args.mediaStatus === 'failed' || args.pendingExpired === true) return 'error';
  return 'pending';
}

/** Quanto falta (ms) para a mídia passar do prazo; `null` se não se aplica. */
function msUntilExpiry(createdAt: string | undefined, now: number): number | null {
  if (createdAt === undefined) return null;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  return created + MEDIA_PENDING_TIMEOUT_MS - now;
}

export function useMediaResource({
  conversationId,
  messageId,
  initialUrl,
  failed = false,
  unavailable = false,
  mediaStatus = null,
  failureReason = null,
  createdAt,
  canRetryDownload = false,
}: UseMediaResourceArgs): MediaResource {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [status, setStatus] = useState<RefreshStatus>('live');
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [pendingExpired, setPendingExpired] = useState<boolean>(() => {
    const left = msUntilExpiry(createdAt, Date.now());
    return left !== null && left <= 0;
  });
  // Evita loop de refresh: só uma reidratação automática por URL servida.
  const triedRef = useRef(false);
  const requeueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O servidor entregou uma nova URL (media_ready invalida → refetch), um novo estado
  // (refetch, ou `media_failed` depois do "tentar de novo") ou a mensagem mudou.
  useEffect(() => {
    setUrl(initialUrl);
    setStatus('live');
    triedRef.current = false;
    if (requeueTimerRef.current !== null) {
      clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = null;
    }
  }, [initialUrl, messageId, mediaStatus, failureReason, failed]);

  useEffect(
    () => () => {
      if (requeueTimerRef.current !== null) clearTimeout(requeueTimerRef.current);
    },
    [],
  );

  // Prazo de "carregando": agenda UMA virada para quando ele vencer.
  useEffect(() => {
    if (initialUrl !== null) return undefined;
    const left = msUntilExpiry(createdAt, Date.now());
    if (left === null) return undefined;
    if (left <= 0) {
      setPendingExpired(true);
      return undefined;
    }
    setPendingExpired(false);
    const timer = setTimeout(() => setPendingExpired(true), left);
    return () => clearTimeout(timer);
  }, [createdAt, initialUrl]);

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

  /**
   * Pede ao servidor um novo download; o `media_ready` (refetch) fecha o ciclo. Se nada
   * chegar no prazo — o storage segue recusando e o worker não reemite a mesma falha —,
   * a bolha volta ao erro em vez de girar de novo para sempre.
   */
  const requeue = useCallback((): void => {
    setRetryNotice(null);
    setStatus('requeued');
    void api
      .post<{ status: string }>(
        `/api/conversations/${conversationId}/messages/${messageId}/retry-media`,
      )
      .then(() => {
        if (requeueTimerRef.current !== null) clearTimeout(requeueTimerRef.current);
        requeueTimerRef.current = setTimeout(() => {
          setStatus((s) => (s === 'requeued' ? 'error' : s));
        }, MEDIA_PENDING_TIMEOUT_MS);
      })
      .catch((err: unknown) => {
        setStatus('error');
        setRetryNotice(
          err instanceof ApiError && err.status === 409
            ? err.message
            : 'Não foi possível tentar de novo agora.',
        );
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

  // Sem URL, o problema é o arquivo (download/storage), não a assinatura: reidratar
  // não adianta — só um novo download, e só para quem pode pedir.
  const downloadFailed = url === null;
  const retry = useCallback((): void => {
    triedRef.current = true;
    if (downloadFailed) requeue();
    else refresh();
  }, [downloadFailed, refresh, requeue]);

  const state = deriveMediaState({
    url,
    status,
    failed,
    unavailable,
    mediaStatus,
    failureReason,
    pendingExpired,
  });
  return {
    url: state === 'ready' ? url : null,
    state,
    canRetry: state === 'error' && (!downloadFailed || canRetryDownload),
    retryNotice,
    onMediaError,
    retry,
  };
}
