'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Variante de velocidade CONSTANTE do efeito de borda neon, para componentes
 * grandes e horizontais (ex.: a barra de Flows do LiveChat).
 *
 * O efeito visual (cor, glow, gradiente cônico, máscara) vive 100% no CSS e é
 * compartilhado — este hook NÃO o reimplementa. Ele apenas fixa a *duração de
 * uma volta* (`--hm-neon-duration`) num valor único e calmo.
 *
 * Diferença para o efeito padrão dos componentes pequenos: a linha neon padrão
 * dá a volta em 4.5s, o que num componente grande faz a luz "correr". Aqui a
 * volta é mais longa e constante — a luz circula sempre no mesmo ritmo, sem
 * aceleração e sem variar quando o componente é redimensionado. Discreta o
 * suficiente para não chamar atenção, presente o suficiente para manter o
 * acabamento premium.
 *
 * O efeito padrão (`.hm-chat-neon`, 4.5s) permanece intacto: este hook é
 * opt-in e só afeta o elemento ao qual o ref é anexado.
 */

/**
 * Duração (em segundos) de uma volta da linha neon nos componentes grandes.
 * Velocidade baixa/mediana — único ponto de ajuste do ritmo. Maior = mais lento.
 */
const NEON_STEADY_DURATION_S = 11;

/**
 * Retorna um `ref` para anexar ao elemento que carrega a classe neon
 * (`.hm-flow-neon`). Fixa uma velocidade de circulação constante e calma.
 *
 * @param durationSeconds Duração de uma volta (s). Default {@link NEON_STEADY_DURATION_S}.
 * @example
 * const neonRef = useNeonBorderSteady<HTMLDivElement>();
 * return <div ref={neonRef} className="hm-flow-neon ...">…</div>;
 */
export function useNeonBorderSteady<T extends HTMLElement = HTMLElement>(
  durationSeconds: number = NEON_STEADY_DURATION_S,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    ref.current?.style.setProperty('--hm-neon-duration', `${durationSeconds}s`);
  }, [durationSeconds]);

  return ref;
}
