import type { CSSProperties } from 'react';

/**
 * Cor do tipo de conversão é dado do cliente (cadastrada pela API ou pelo form) e vai
 * para `style`. Só um hex `#RRGGBB` passa: qualquer outra coisa (`url(...)`, `var(...)`,
 * `expression(...)`, nomes, hex curto) é descartada e o ponto cai no token da classe
 * (`bg-text-low`). Regex ancorada nas duas pontas, sem flags além de `i`.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** O valor, se for um `#RRGGBB` válido; senão `null`. */
export function safeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return HEX_COLOR.test(value) ? value : null;
}

/** `style` do ponto de cor: só com hex válido; sem ele, fica a cor do token da classe. */
export function dotColorStyle(value: string | null | undefined): CSSProperties | undefined {
  const color = safeHexColor(value);
  return color ? { backgroundColor: color } : undefined;
}
