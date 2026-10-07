/**
 * Famílias de fonte do DS 3.0 e helper de carregamento (DESIGN_SYSTEM §15; ADR-002).
 *
 * Três famílias (eram quatro): Space Grotesk (heads), Manrope (corpo), IBM Plex
 * Mono (número/dado). Orbitron, Rajdhani e Chakra Petch saíram. O app Next.js
 * carrega via `next/font` (apps/web/app/layout.tsx) para evitar layout shift;
 * `googleFontsHref` serve só a contextos fora do Next (Ladle, docs).
 */

export const fonts = {
  /** Títulos / display (`--font-head`; `--font-display` é alias) */
  head: 'Space Grotesk',
  /** Corpo */
  body: 'Manrope',
  /** Número / dado / kicker (`--font-mono`; `--font-price` é alias) */
  mono: 'IBM Plex Mono',
} as const;

export type FontName = (typeof fonts)[keyof typeof fonts];

/** Pesos usados por família (alinha com os `next/font` weights). */
export const fontWeights = {
  'Space Grotesk': [500, 600, 700],
  Manrope: [400, 500, 600, 700],
  'IBM Plex Mono': [400, 500, 600],
} as const;

/** `<link href>` do Google Fonts com todas as famílias/pesos do DS. */
export const googleFontsHref =
  'https://fonts.googleapis.com/css2' +
  '?family=Space+Grotesk:wght@500;600;700' +
  '&family=Manrope:wght@400;500;600;700' +
  '&family=IBM+Plex+Mono:wght@400;500;600' +
  '&display=swap';
