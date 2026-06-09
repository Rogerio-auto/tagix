/**
 * @hm/design-tokens — fonte única dos tokens do Design System v2 (dark-first).
 *
 * - Tokens CSS (runtime): `import '@hm/design-tokens/tokens.css'`.
 * - Preset Tailwind: `import { tailwindPreset } from '@hm/design-tokens/tailwind-preset'`.
 * - Tokens tipados (TS): este barrel.
 *
 * Vide `docs/DESIGN_SYSTEM.md` §2, §3, §7, §15. Regra dura: nenhum hex hardcoded
 * em JSX/TSX — sempre via token semântico (`var(--…)` ou classe Tailwind mapeada).
 */

export * from './typography';
export * from './fonts';
export { tailwindPreset, default as preset } from './tailwind-preset';
export type { TailwindPreset } from './tailwind-preset';

/** Verde-neon da marca — usado com escassez (1 por tela; CTA principal/status). */
export const BRAND_NEON = '#1FFF13' as const;

/** Tokens de marca como referências CSS var (para uso em estilos inline tipados). */
export const brandColors = {
  brand: 'var(--brand)',
  strong: 'var(--brand-strong)',
  bright: 'var(--brand-bright)',
  price: 'var(--brand-price)',
  soft: 'var(--brand-soft)',
  faint: 'var(--brand-faint)',
} as const;

/** Raios (DESIGN_SYSTEM §2.1). */
export const radii = {
  xs: '6px',
  sm: '10px',
  md: '14px',
  lg: '20px',
  pill: '999px',
} as const;

/** Espaçamento base-8 + extras (DESIGN_SYSTEM §2.1). */
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  7: '48px',
  8: '64px',
  9: '96px',
} as const;

export type ThemeName = 'dark' | 'light';

export const DESIGN_TOKENS_PKG = '@hm/design-tokens' as const;
