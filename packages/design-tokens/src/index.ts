/**
 * @hm/design-tokens — tokens semânticos do Design System v2 (dark-first).
 *
 * Fonte única dos tokens. O Tailwind preset (@hm/ui) e os CSS vars derivam
 * destes valores. Regra dura (DESIGN_SYSTEM.md): nenhum hex hardcoded em JSX —
 * tudo vem daqui via token semântico.
 */

/** Verde-neon da marca — usado com escassez no produto (acento, nunca fundo). */
export const BRAND_NEON = '#1FFF13' as const;

export const fonts = {
  display: 'Orbitron',
  heading: 'Chakra Petch',
  ui: 'Rajdhani',
  body: 'Manrope',
} as const;

export const radii = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  pill: '9999px',
} as const;

export type ThemeName = 'dark' | 'light';

export const DESIGN_TOKENS_PKG = '@hm/design-tokens' as const;
