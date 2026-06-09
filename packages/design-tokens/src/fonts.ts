/**
 * Famílias de fonte do DS v2 e helper de carregamento (DESIGN_SYSTEM §15).
 *
 * Em dev/MVP: Google Fonts via <link> (use `googleFontsHref`). O app Next.js
 * (F0-S11) carrega via `next/font` para evitar layout shift. Self-host
 * (Fontsource) é fase 2.
 */

export const fonts = {
  /** Logo / selos */
  display: 'Orbitron',
  /** Heads, kickers */
  head: 'Rajdhani',
  /** Corpo */
  body: 'Manrope',
  /** Preços / números */
  price: 'Chakra Petch',
} as const;

export type FontName = (typeof fonts)[keyof typeof fonts];

/** Pesos usados por família (alinha com os `next/font` weights). */
export const fontWeights = {
  Rajdhani: [500, 600, 700],
  Manrope: [400, 500, 600, 700],
  'Chakra Petch': [500, 600, 700],
  Orbitron: [600, 700, 800],
} as const;

/** `<link href>` do Google Fonts com todas as famílias/pesos do DS. */
export const googleFontsHref =
  'https://fonts.googleapis.com/css2' +
  '?family=Rajdhani:wght@500;600;700' +
  '&family=Manrope:wght@400;500;600;700' +
  '&family=Chakra+Petch:wght@500;600;700' +
  '&family=Orbitron:wght@600;700;800' +
  '&display=swap';
