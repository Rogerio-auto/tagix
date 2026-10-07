/**
 * Escala tipográfica hierárquica do DS 3.0 (DESIGN_SYSTEM §3 e §3-v3; ADR-002).
 *
 * FONTE ÚNICA da escala editorial (Linear/Stripe/Vercel): tamanhos, pesos,
 * line-heights e tracking. Consumida em dois lugares:
 *   - `tailwind-preset.ts` deriva daqui o mapa `fontSize` (utilitários `text-*`).
 *   - `tokens.css` (`@theme`) espelha estes valores para gerar os mesmos
 *     utilitários no pipeline CSS-first do app (Tailwind 4). Mantê-los em sincronia.
 *
 * `family` referencia o token de fonte (`--font-<family>`). `price` é alias de
 * `mono` e `display` de `head` (ADR-002). Corpo e heads NUNCA em uppercase; caixa-alta
 * só em kicker/eyebrow mono curtos, aplicada no componente.
 *
 * `lineHeight` é unitless (proporção): heads apertadas (rítmo editorial),
 * corpo arejado para legibilidade longa, preços/kickers travados.
 */

export type FontFamilyToken = 'display' | 'price' | 'head' | 'body' | 'mono';

export interface TypeStyle {
  readonly family: FontFamilyToken;
  readonly size: string;
  readonly weight: number;
  /** proporção unitless (line-height CSS) */
  readonly lineHeight: string;
  readonly tracking: string;
  /** `font-variant-numeric: tabular-nums` (número/dado em coluna) */
  readonly tabularNums?: boolean;
}

export const typography = {
  h1: { family: 'head', size: '60px', weight: 600, lineHeight: '1.04', tracking: '-0.045em' },
  h2: { family: 'head', size: '40px', weight: 600, lineHeight: '1.08', tracking: '-0.035em' },
  h3: { family: 'head', size: '28px', weight: 600, lineHeight: '1.15', tracking: '-0.035em' },
  h4: { family: 'head', size: '21px', weight: 600, lineHeight: '1.25', tracking: '-0.035em' },
  body: { family: 'body', size: '16px', weight: 500, lineHeight: '1.65', tracking: '0' },
  small: { family: 'body', size: '13px', weight: 400, lineHeight: '1.5', tracking: '0.1px' },
  price: {
    family: 'mono',
    size: '40px',
    weight: 500,
    lineHeight: '1',
    tracking: '0',
    tabularNums: true,
  },
  display: { family: 'head', size: '16px', weight: 700, lineHeight: '1.1', tracking: '-0.02em' },
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
