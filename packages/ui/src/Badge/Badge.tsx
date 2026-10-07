import type { HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

/**
 * Badge / StatusPill do DS 3.0 (maquete §03 "Status, badges & switches").
 * Tinta de 8–10% + borda de 20–25% + texto no tom do estado. O texto usa os tokens
 * de estado já medidos ≥4,5:1 nos dois temas (tokens.test.ts); `brand` usa `brand-text`
 * porque a marca neon nunca é cor de texto no tema claro.
 */
const badgeVariants = cva(
  [
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border font-body font-bold',
    'transition-colors duration-(--dur-base) ease-ds',
  ],
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-2 text-text-mid',
        brand: 'border-brand-text/25 bg-brand-text/10 text-brand-text',
        info: 'border-info/25 bg-info/10 text-info',
        warning: 'border-warn/25 bg-warn/10 text-warn',
        danger: 'border-danger/25 bg-danger/10 text-danger',
        success: 'border-success/25 bg-success/10 text-success',
        violet: 'border-violet/25 bg-violet/[0.06] text-violet',
      },
      size: {
        sm: 'h-5 px-2 text-xs',
        md: 'h-6 px-2.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>['size']>;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Ponto de estado à esquerda. O significado nunca é só a cor: o texto sempre está presente. */
  dot?: boolean;
  /**
   * Signal pulse (DS 3.0 §05): o ponto pulsa. SÓ para estado vivo (conexão ativa,
   * geração em andamento). Estático sob `prefers-reduced-motion`.
   */
  live?: boolean;
  children: ReactNode;
}

export function Badge({ tone, size, dot = false, live = false, className, children, ...props }: BadgeProps) {
  const showDot = dot || live;
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {showDot && (
        <i
          aria-hidden
          data-live={live || undefined}
          className={cn(
            'size-1.5 shrink-0 rounded-pill bg-current',
            live && 'motion-safe:animate-[hm-signal_1.8s_var(--ease)_infinite]',
          )}
        />
      )}
      {children}
    </span>
  );
}

export type StatusPillProps = Omit<BadgeProps, 'dot'>;

/** Badge de status: sempre com ponto. Atalho semântico para listas/tabelas ("Ao vivo", "Revisão", "Bloqueado"). */
export function StatusPill(props: StatusPillProps) {
  return <Badge {...props} dot />;
}
