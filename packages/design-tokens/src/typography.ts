/**
 * Escala tipográfica hierárquica do DS v2 (DESIGN_SYSTEM §3).
 *
 * `family` referencia o token de fonte (`--font-<family>`). Corpo NUNCA em
 * uppercase; caixa-alta condensada só em heads e kickers curtos.
 */

export type FontFamilyToken = 'display' | 'price' | 'head' | 'body';

export interface TypeStyle {
  readonly family: FontFamilyToken;
  readonly size: string;
  readonly weight: number;
  readonly tracking: string;
  /** caixa-alta (apenas display/kickers) */
  readonly uppercase?: boolean;
}

export const typography = {
  h1: { family: 'head', size: '60px', weight: 600, tracking: '-0.5px' },
  h2: { family: 'head', size: '40px', weight: 600, tracking: '-0.3px' },
  h3: { family: 'head', size: '28px', weight: 600, tracking: '-0.2px' },
  h4: { family: 'head', size: '21px', weight: 600, tracking: '-0.1px' },
  body: { family: 'body', size: '17px', weight: 400, tracking: '0' },
  small: { family: 'body', size: '13px', weight: 400, tracking: '0.1px' },
  price: { family: 'price', size: '40px', weight: 600, tracking: '0' },
  display: { family: 'display', size: '16px', weight: 700, tracking: '1.5px', uppercase: true },
} as const satisfies Record<string, TypeStyle>;

export type TypeScaleToken = keyof typeof typography;
