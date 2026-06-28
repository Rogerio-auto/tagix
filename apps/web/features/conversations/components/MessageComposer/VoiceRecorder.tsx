'use client';

/**
 * Estado de gravação de nota de voz (F45-S04 / RICH_COMPOSER §4). SUBSTITUI o
 * input enquanto grava: timer mm:ss + onda em tempo real (via `AnalyserNode`) +
 * ✕ cancelar + ➤ enviar. Soltar fora NÃO envia (não há gesto press-and-hold) —
 * o envio é um clique explícito, evitando ação acidental (UX §2.1/§2.9). `Esc`
 * cancela (UX §2.10); o botão de enviar recebe foco ao iniciar.
 *
 * Permissão negada / erro renderizam uma faixa de alerta legível com um botão de
 * dispensar que devolve ao input (sem crash).
 *
 * DS v2: zero hex — a onda lê a cor computada de um token (`text-text-mid`) para
 * pintar o canvas; o verde-neon `--brand` aparece UMA vez (botão enviar). Alvos
 * ≥44px; foco `focus-visible:shadow-glow-md`. `prefers-reduced-motion` respeitado
 * (sem rAF contínuo e sem pulso).
 */

import { useEffect, useRef } from 'react';
import { Loader2, MicOff, SendHorizontal, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { VoiceRecorderState } from './useVoiceRecorder';

export interface VoiceRecorderProps {
  readonly state: VoiceRecorderState;
  readonly elapsedMs: number;
  readonly analyser: AnalyserNode | null;
  readonly error: string | null;
  /** Upload/envio em curso (após `stop`) — trava os controles e mostra spinner. */
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onSend: () => void;
  readonly className?: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Desenha a onda em tempo real a partir do `AnalyserNode`. A cor vem da cor
 * computada do próprio canvas (classe de token), mantendo zero hex. Sem analyser
 * (Web Audio indisponível) renderiza nada — o resto da UI segue funcional.
 */
function Waveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    let raf = 0;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) {
        if (!reduceMotion) raf = requestAnimationFrame(draw);
        return;
      }
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = getComputedStyle(canvas).color || 'currentColor';

      analyser.getByteFrequencyData(data);
      const barCount = 28;
      const gap = 3;
      const barWidth = Math.max(2, (cssW - gap * (barCount - 1)) / barCount);
      for (let i = 0; i < barCount; i += 1) {
        const index = Math.min(bins - 1, Math.floor((i / barCount) * bins));
        const amplitude = (data[index] ?? 0) / 255;
        const height = Math.max(2, amplitude * cssH);
        const x = i * (barWidth + gap);
        const y = (cssH - height) / 2;
        ctx.fillRect(x, y, barWidth, height);
      }
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [analyser]);

  return <canvas ref={canvasRef} className="h-7 w-full text-text-mid" aria-hidden />;
}

export function VoiceRecorder({
  state,
  elapsedMs,
  analyser,
  error,
  busy = false,
  onCancel,
  onSend,
  className,
}: VoiceRecorderProps) {
  const sendRef = useRef<HTMLButtonElement>(null);
  const isFault = state === 'denied' || state === 'error';
  const isRecording = state === 'recording';

  // Foco no envio ao começar a gravar → `Esc`/teclado caem no escopo do gravador.
  useEffect(() => {
    if (isRecording) sendRef.current?.focus();
  }, [isRecording]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  if (isFault) {
    return (
      <div
        role="group"
        aria-label="Falha na gravação de voz"
        onKeyDown={onKeyDown}
        className={cn('flex w-full items-center gap-2', className)}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-danger">
          <MicOff className="size-5" aria-hidden />
        </span>
        <p role="alert" className="min-w-0 flex-1 font-body text-sm text-text-mid">
          {error ?? 'Não foi possível gravar a nota de voz.'}
        </p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fechar e voltar à mensagem"
          title="Fechar"
          className="touch-target flex items-center justify-center rounded-md text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Gravando nota de voz"
      onKeyDown={onKeyDown}
      className={cn('flex w-full items-center gap-2', className)}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center text-danger"
        aria-hidden
      >
        <span className="size-2.5 rounded-full bg-danger motion-safe:animate-pulse" />
      </span>

      <span
        className="shrink-0 font-body text-sm font-medium tabular-nums text-text"
        aria-label={`Duração ${formatElapsed(elapsedMs)}`}
      >
        {state === 'requesting' ? 'Permitir microfone…' : formatElapsed(elapsedMs)}
      </span>

      <div className="min-w-0 flex-1">{isRecording ? <Waveform analyser={analyser} /> : null}</div>

      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label="Cancelar gravação"
        title="Cancelar"
        className="touch-target flex items-center justify-center rounded-md text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="size-5" aria-hidden />
      </button>

      <button
        ref={sendRef}
        type="button"
        onClick={onSend}
        disabled={!isRecording || busy}
        aria-label="Enviar nota de voz"
        aria-busy={busy || undefined}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
          'focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
          isRecording && !busy
            ? 'bg-brand text-text-on-brand hover:bg-brand-strong'
            : 'bg-surface-3 text-text-low',
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <SendHorizontal className="size-5" aria-hidden />
        )}
      </button>
    </div>
  );
}
