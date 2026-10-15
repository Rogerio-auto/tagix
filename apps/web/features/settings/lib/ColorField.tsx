'use client';

import { cn } from '@/shared/lib/cn';
import { useTokenHex } from './token-color';

export interface ColorSwatchInputProps {
  /** Cor escolhida (`#RRGGBB`) ou `''` = ainda não escolhida (mostra o padrão do token). */
  value: string;
  onChange: (hex: string) => void;
  /** Nome acessível do seletor. */
  label: string;
  /** Token que dá a cor inicial quando nada foi escolhido. */
  fallbackToken?: `--${string}`;
  disabled?: boolean;
  className?: string;
}

/**
 * Seletor de cor nativo pintado como amostra do DS 3.0 (hairline, raio `sm`, foco com anel).
 * A cor exibida sem escolha vem do token (`--brand`), nunca de um hex no componente.
 * Antes do token resolver (primeiro paint) mostra a amostra do próprio token por classe.
 */
export function ColorSwatchInput({
  value,
  onChange,
  label,
  fallbackToken = '--brand',
  disabled,
  className,
}: ColorSwatchInputProps): React.JSX.Element {
  const fallback = useTokenHex(fallbackToken);
  const shown = value || fallback;
  const base = 'h-10 w-12 shrink-0 rounded-sm border border-border-2 bg-surface-2';

  if (!shown) {
    // Sem valor válido ainda: nada de `<input type="color" value="">` (o navegador acusa).
    return <span aria-hidden className={cn(base, 'p-1', className)}><span className="block size-full rounded-xs bg-brand" /></span>;
  }

  return (
    <input
      type="color"
      value={shown}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      aria-label={label}
      disabled={disabled}
      className={cn(
        base,
        'cursor-pointer p-1 outline-none transition-[border-color] duration-(--dur-base) hover:border-border-brand focus-visible:focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-40',
        '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-xs [&::-webkit-color-swatch]:border-0',
        '[&::-moz-color-swatch]:rounded-xs [&::-moz-color-swatch]:border-0',
        className,
      )}
    />
  );
}
