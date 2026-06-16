'use client';

import { useMediaQuery } from './useMediaQuery';

/**
 * Tier de viewport canônico do app (F36 — MOBILE_RESPONSIVE_PLAN §4/§5).
 * Corte mobile em `< md` (768px): abaixo disso o app usa os padrões mobile
 * (sheets, pilha de views, tabela→cards); `md+` mantém o layout desktop. — D4.
 */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/** Larguras canônicas (px) dos cortes. Espelham os breakpoints do Tailwind. */
export const BREAKPOINTS = {
  /** `< md` → mobile. */
  md: 768,
  /** `< lg` → tablet; `>= lg` → desktop. */
  lg: 1024,
} as const;

export interface BreakpointState {
  /** Tier atual: `mobile` (< 768), `tablet` (768–1023), `desktop` (>= 1024). */
  breakpoint: Breakpoint;
  /** `< 768px` — usa os padrões mobile (thumb-first, sheets, cards). */
  isMobile: boolean;
  /** `768–1023px`. */
  isTablet: boolean;
  /** `>= 1024px` — layout desktop completo. */
  isDesktop: boolean;
  /** `< 1024px` — conveniência para "não-desktop" (mobile OU tablet). */
  isBelowDesktop: boolean;
}

/**
 * Hook de tier responsivo, SSR-safe (sem flash de hidratação, sem warning),
 * reativo a resize via `matchMedia`. Base de toda a fase mobile — os slots
 * S02..S12 consomem `isMobile`/`breakpoint` para alternar entre padrões.
 *
 * No servidor (e no primeiro snapshot do cliente) ambas as queries resolvem
 * `false`, o que equivale a `mobile`. Isso é proposital: o conteúdo mobile é
 * o layout-base e progressivamente melhora para desktop, evitando saltos.
 */
export function useBreakpoint(): BreakpointState {
  const isMdUp = useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`);
  const isLgUp = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);

  const breakpoint: Breakpoint = isLgUp ? 'desktop' : isMdUp ? 'tablet' : 'mobile';

  return {
    breakpoint,
    isMobile: !isMdUp,
    isTablet: isMdUp && !isLgUp,
    isDesktop: isLgUp,
    isBelowDesktop: !isLgUp,
  };
}
