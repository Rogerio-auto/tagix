import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/* DS 3.0: borda antes de sombra. 1 e 2 repousam só com hairline; sombra só quando flutua. */
const elevationClass = {
  1: 'shadow-none',
  2: 'shadow-ds-1',
  3: 'shadow-ds-2',
  4: 'shadow-ds-3',
} as const;

export type CardElevation = keyof typeof elevationClass;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 1 = lista (só borda) · 2 = padrão · 3 = hover/dropdown · 4 = overlay (DESIGN_SYSTEM §4.3). */
  elevation?: CardElevation;
  /**
   * Card que é alvo de clique (UX §2.1): ganha Lift no hover, borda de marca e foco visível.
   * Quem usa deve dar `role`/`tabIndex`/`onClick` ou envolver num link; o Card só pinta o estado.
   */
  interactive?: boolean;
}

export function Card({ elevation = 2, interactive = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface',
        elevationClass[elevation],
        interactive && [
          'cursor-pointer outline-none transition-[transform,box-shadow,border-color] duration-(--dur-slow) ease-ds-spring',
          'hover:border-border-brand hover:shadow-ds-2 motion-safe:hover:-translate-y-0.5',
          'focus-visible:focus-ring',
        ],
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, action, className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn('flex items-center justify-between gap-4 border-b border-border px-5 py-4', className)}
      {...props}
    >
      {children ?? <h3 className="font-head text-lg font-semibold text-text">{title}</h3>}
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}
