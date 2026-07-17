import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

/**
 * Tom do badge do ícone. `error-adjacent` sinaliza um vazio causado por erro
 * (ex.: lista que não carregou) sem escalar para o ErrorState de página inteira.
 */
const iconBadge = cva('flex shrink-0 items-center justify-center rounded-pill border', {
  variants: {
    variant: {
      'first-run': 'size-16 border-border-2 bg-surface-2 text-text-low',
      'no-results': 'size-14 border-border-2 bg-surface-2 text-text-low',
      'error-adjacent': 'size-14 border-danger/25 bg-danger/10 text-danger',
    },
  },
  defaultVariants: { variant: 'first-run' },
});

const iconSize = {
  'first-run': 'size-7',
  'no-results': 'size-6',
  'error-adjacent': 'size-6',
} as const;

export type EmptyStateVariant = NonNullable<VariantProps<typeof iconBadge>['variant']>;

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Intenção do vazio (DESIGN_SYSTEM §10.3 / UX §2.6):
   * - `first-run`: tela sem dado ainda → convide com CTA.
   * - `no-results`: busca/filtro sem retorno → sugira limpar filtro.
   * - `error-adjacent`: falhou ao carregar → tom de alerta contido.
   */
  variant?: EmptyStateVariant;
  /** CTA primário ÚNICO — passe um `<Button variant="primary">`. */
  action?: ReactNode;
  /** Ação de escape secundária (ex.: "Limpar filtros") — `<Button variant="ghost">`. */
  secondaryAction?: ReactNode;
}

/**
 * Estado vazio acionável (UX §2.6, §3.5). Nunca texto morto: quando há dado a criar,
 * exponha um CTA. Tokens semânticos, dark/light, zero hex.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  variant = 'first-run',
  action,
  secondaryAction,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <span className={iconBadge({ variant })}>
        <Icon className={iconSize[variant]} aria-hidden strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-head text-xl font-semibold text-text">{title}</h2>
        {description && <p className="max-w-md font-body text-sm text-text-mid">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
