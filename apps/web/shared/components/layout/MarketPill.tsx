import { cn } from '@/shared/lib/cn';

export interface MarketPillProps {
  /** Texto já formatado do mercado da empresa (ex.: país e fuso). Vem do dado real. */
  label?: string | null;
  className?: string;
}

/**
 * Pílula de mercado da maquete (`.market-pill`), RESERVADA na TopBar. O `/api/me`
 * ainda não expõe o mercado da empresa, então hoje ela não renderiza nada — nunca
 * um país ou fuso inventado. Quando o dado existir, basta passar `label` (a
 * formatação e o fuso vêm dos helpers de `@hm/shared`, sem literal aqui).
 */
export function MarketPill({ label, className }: MarketPillProps) {
  if (!label) return null;
  return (
    <span
      data-slot="market-pill"
      className={cn(
        'mr-2 inline-flex h-8 items-center rounded-sm border border-border bg-surface px-2.5 font-mono text-xs text-text-mid',
        className,
      )}
    >
      {label}
    </span>
  );
}
