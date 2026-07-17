/**
 * Escala tipográfica hierárquica do DS v2 (DESIGN_SYSTEM §3).
 *
 * FONTE ÚNICA da escala editorial (Linear/Stripe/Vercel): tamanhos, pesos,
 * line-heights e tracking. Consumida em dois lugares:
 *   - `tailwind-preset.ts` deriva daqui o mapa `fontSize` (utilitários `text-*`).
 *   - `tokens.css` (`@theme`) espelha estes valores para gerar os mesmos
 *     utilitários no pipeline CSS-first do app (Tailwind 4). Mantê-los em sincronia.
 *
 * `family` referencia o token de fonte (`--font-<family>`). Corpo NUNCA em
 * uppercase; caixa-alta condensada só em heads e kickers curtos.
 *
 * `lineHeight` é unitless (proporção): heads apertadas (rítmo editorial),
 * corpo arejado para legibilidade longa, preços/kickers travados.
 */

export type FontFamilyToken = 'display' | 'price' | 'head' | 'body';

export interface TypeStyle {
  readonly family: FontFamilyToken;
  readonly size: string;
  readonly weight: number;
  /** proporção unitless (line-height CSS) */
  readonly lineHeight: string;
  readonly tracking: string;
  /** caixa-alta (apenas display/kickers) */
  readonly uppercase?: boolean;
}

export const typography = {
  h1: { family: 'head', size: '60px', weight: 600, lineHeight: '1.04', tracking: '-0.5px' },
  h2: { family: 'head', size: '40px', weight: 600, lineHeight: '1.08', tracking: '-0.3px' },
  h3: { family: 'head', size: '28px', weight: 600, lineHeight: '1.15', tracking: '-0.2px' },
  h4: { family: 'head', size: '21px', weight: 600, lineHeight: '1.25', tracking: '-0.1px' },
  body: { family: 'body', size: '17px', weight: 400, lineHeight: '1.6', tracking: '0' },
  small: { family: 'body', size: '13px', weight: 400, lineHeight: '1.5', tracking: '0.1px' },
  price: { family: 'price', size: '40px', weight: 600, lineHeight: '1', tracking: '0' },
  display: {
    family: 'display',
    size: '16px',
    weight: 700,
    lineHeight: '1.1',
    tracking: '1.5px',
    uppercase: true,
  },
} as const satisfies Record<string, TypeStyle>;

export type TypeScaleToken = keyof typeof typography;

/**
 * Descritor de um utilitário de fonte no formato do Tailwind
 * (`[fontSize, { lineHeight, letterSpacing, fontWeight }]`).
 */
export type FontSizeUtility = readonly [
  string,
  {
    readonly lineHeight: string;
    readonly letterSpacing: string;
    readonly fontWeight: string;
  },
];

/** Converte um `TypeStyle` no descritor `fontSize` do Tailwind. */
export function toFontSizeUtility(style: TypeStyle): FontSizeUtility {
  return [
    style.size,
    {
      lineHeight: style.lineHeight,
      letterSpacing: style.tracking,
      fontWeight: String(style.weight),
    },
  ];
}

/**
 * Mapa `fontSize` derivado da escala — cada chave vira o utilitário `text-<token>`
 * (`text-h1`, `text-h2`, `text-h3`, `text-h4`, `text-body`, `text-small`,
 * `text-price`, `text-display`). Fonte do bloco `fontSize` do preset Tailwind.
 */
export const fontSizeScale: Record<TypeScaleToken, FontSizeUtility> = {
  h1: toFontSizeUtility(typography.h1),
  h2: toFontSizeUtility(typography.h2),
  h3: toFontSizeUtility(typography.h3),
  h4: toFontSizeUtility(typography.h4),
  body: toFontSizeUtility(typography.body),
  small: toFontSizeUtility(typography.small),
  price: toFontSizeUtility(typography.price),
  display: toFontSizeUtility(typography.display),
};
