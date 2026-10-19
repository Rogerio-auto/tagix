'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Balão de fala do companheiro (SPEC §2.4): sempre `aria-hidden` e `pointer-events: none`,
 * só repete o que a tela já diz (ou é saudação). Estilo em `companion.css`.
 *
 * - `start`: à esquerda da figura (posto `heading`), rabicho para a direita.
 * - `below`: abaixo da figura (posto `inline`), alinhado à direita, rabicho para cima.
 *
 * Entra em 200 ms; ao sair fica montado por 140 ms só para o fade (`data-open`).
 */

export type BubblePlacement = 'start' | 'below';

export interface BubbleProps {
  /** Texto atual; `null` fecha. */
  text: string | null;
  /** Muda a cada balão novo (reinicia a entrada mesmo com o mesmo texto). */
  seq: number;
  placement: BubblePlacement;
}

export const BUBBLE_EXIT_MS = 140;

export function Bubble({ text, seq, placement }: BubbleProps): ReactNode {
  const lastText = useRef<string>('');
  const [mounted, setMounted] = useState(text !== null);
  const [phase, setPhase] = useState<'pre' | 'true' | 'out'>('pre');

  if (text !== null) lastText.current = text;

  useEffect(() => {
    if (text === null) {
      setPhase('out');
      const t = setTimeout(() => setMounted(false), BUBBLE_EXIT_MS);
      return () => clearTimeout(t);
    }
    setMounted(true);
    // Um quadro com `data-open=false` para a transição de entrada ter de onde partir.
    setPhase('pre');
    const t = setTimeout(() => setPhase('true'), 16);
    return () => clearTimeout(t);
  }, [text, seq]);

  if (!mounted) return null;
  return (
    <span
      aria-hidden="true"
      data-companion-bubble=""
      data-placement={placement}
      className="m-bubble-pos"
    >
      <span className="m-bubble" data-open={phase === 'pre' ? 'false' : phase}>
        {lastText.current}
      </span>
    </span>
  );
}
