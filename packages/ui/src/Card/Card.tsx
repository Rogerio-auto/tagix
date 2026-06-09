import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

const elevationClass = {
  1: 'shadow-elev-1',
  2: 'shadow-elev-2',
  3: 'shadow-elev-3',
  4: 'shadow-elev-4',
} as const;

export type CardElevation = keyof typeof elevationClass;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 1 = lista · 2 = padrão · 3 = hover/dropdown · 4 = modal (DESIGN_SYSTEM §4.3). */
  elevation?: CardElevation;
}

export function Card({ elevation = 2, className, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface', elevationClass[elevation], className)}
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
      className={cn('flex items-center justify-between gap-4 border-b border-border-2 px-5 py-4', className)}
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
