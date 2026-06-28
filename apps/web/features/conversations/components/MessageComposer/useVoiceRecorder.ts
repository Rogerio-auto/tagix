'use client';

/**
 * Captura de nota de voz no navegador (F45-S04 / RICH_COMPOSER §1,§4).
 *
 * Encapsula `getUserMedia({ audio })` + `MediaRecorder`, escolhendo o melhor MIME
 * suportado por `MediaRecorder.isTypeSupported` (o navegador NÃO grava ogg/opus —
 * o S01 transcoda server-side no upload `as=voice`, e o S02 manda `voice:true`).
 *
 * Expõe `start`/`stop`/`cancel`, o `state`, o `elapsedMs` (timer) e um
 * `AnalyserNode` (onda em tempo real, consumido pela UI). `stop()` resolve com o
 * `Blob` final; `cancel()` descarta. Em AMBOS os caminhos os tracks do microfone
 * são parados e o `AudioContext` é fechado — o indicador de mic do SO apaga, sem
 * deixar a captura aberta (DoD).
 *
 * Permissão negada / sem suporte degradam para um `state` terminal com `error`
 * legível (a UI mostra a mensagem e volta ao input), nunca crasha.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceRecorderState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'denied'
  | 'error';

/**
 * Candidatos de container/codec na ordem de preferência. Nenhum é ogg/opus (o
 * navegador não grava esse formato) — a normalização para `audio/ogg;codecs=opus`
 * acontece no upload server-side (F45-S01). `undefined` = deixa o navegador
 * escolher o default.
 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export interface VoiceRecorder {
  readonly state: VoiceRecorderState;
  /** Duração corrente da gravação em milissegundos (atualiza a ~10 fps). */
  readonly elapsedMs: number;
  /** Nó de análise para a onda em tempo real (`null` sem Web Audio). */
  readonly analyser: AnalyserNode | null;
  /** Mensagem acionável quando `state` é `denied`/`error`. */
  readonly error: string | null;
  /** Pede o microfone e começa a gravar. No-op se já gravando/solicitando. */
  readonly start: () => Promise<void>;
  /** Encerra e resolve com o `Blob` gravado (ou `null` se nada útil). Libera o mic. */
  readonly stop: () => Promise<Blob | null>;
  /** Descarta a gravação sem produzir blob e libera o mic. */
  readonly cancel: () => void;
}

type AudioContextCtor = typeof AudioContext;

export function useVoiceRecorder(): VoiceRecorder {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<number | null>(null);
  const startTsRef = useRef(0);
  const canceledRef = useRef(false);
  /** Resolver do `stop()` pendente — preenchido pela última promessa de parada. */
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);

  /**
   * Para o timer, encerra todos os tracks de áudio (mic apaga) e fecha o
   * `AudioContext`. Idempotente — chamado em stop, cancel e no unmount.
   */
  const releaseResources = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (ctx && ctx.state !== 'closed') void ctx.close();
    audioContextRef.current = null;
    recorderRef.current = null;
    setAnalyser(null);
  }, []);

  const start = useCallback(async () => {
    if (state === 'recording' || state === 'requesting') return;
    setError(null);

    if (!isSupported()) {
      setState('error');
      setError('Gravação de voz não é suportada neste navegador.');
      return;
    }

    setState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState('denied');
        setError(
          'Permissão de microfone negada. Habilite o acesso ao microfone no navegador para gravar.',
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setState('error');
        setError('Nenhum microfone encontrado.');
      } else {
        setState('error');
        setError('Não foi possível acessar o microfone.');
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    canceledRef.current = false;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      // Opções de MIME rejeitadas em runtime → tenta o default do navegador.
      recorder = new MediaRecorder(stream);
    }
    recorderRef.current = recorder;

    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const canceled = canceledRef.current;
      const chunks = chunksRef.current;
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob =
        !canceled && chunks.length > 0 ? new Blob(chunks, { type }) : null;
      chunksRef.current = [];
      canceledRef.current = false;
      releaseResources();
      setState('idle');
      const resolve = stopResolverRef.current;
      stopResolverRef.current = null;
      resolve?.(blob);
    });

    // Onda em tempo real via Web Audio (best-effort — degrada sem ela).
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (Ctor) {
      try {
        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        source.connect(node);
        audioContextRef.current = ctx;
        setAnalyser(node);
      } catch {
        audioContextRef.current = null;
        setAnalyser(null);
      }
    }

    recorder.start();
    startTsRef.current = performance.now();
    setElapsedMs(0);
    intervalRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startTsRef.current);
    }, 100);
    setState('recording');
  }, [state, releaseResources]);

  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      releaseResources();
      setState('idle');
      return Promise.resolve(null);
    }
    return new Promise<Blob | null>((resolve) => {
      stopResolverRef.current = resolve;
      canceledRef.current = false;
      recorder.stop();
    });
  }, [releaseResources]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      canceledRef.current = true;
      recorder.stop();
      return;
    }
    // Sem gravação ativa (ex.: estado denied/error) — só limpa e volta ao input.
    chunksRef.current = [];
    releaseResources();
    setError(null);
    setState('idle');
  }, [releaseResources]);

  // Garante que o microfone é liberado se o componente desmontar gravando.
  useEffect(() => releaseResources, [releaseResources]);

  return { state, elapsedMs, analyser, error, start, stop, cancel };
}
