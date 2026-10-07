import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * Bloco de carregamento (UX §2.7/§3.6). Pulsa apenas quando o usuário permite
 * animação — `motion-reduce:animate-none` respeita `prefers-reduced-motion`.
 * Decorativo por padrão (`aria-hidden`): quem anuncia o carregamento é o wrapper.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        // Varredura de luz (hm-shimmer) sobre surface-3; parado sob prefers-reduced-motion.
        'rounded-xs bg-surface-3',
        'motion-safe:animate-[hm-shimmer_1.8s_linear_infinite] motion-safe:bg-[length:200%_100%]',
        'motion-safe:bg-[linear-gradient(90deg,var(--surface-3)_30%,var(--surface-2)_50%,var(--surface-3)_70%)]',
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  /** Número de linhas de texto simuladas. */
  lines?: number;
  /** Rótulo anunciado por leitores de tela enquanto carrega. */
  label?: string;
}

/**
 * Parágrafo/label em carregamento — a última linha é mais curta, imitando texto real
 * para não gerar layout shift (CLS) na hidratação.
 */
export function SkeletonText({
  lines = 3,
  label = 'Carregando conteúdo',
  className,
  ...props
}: SkeletonTextProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn('flex flex-col gap-2', className)}
      {...props}
    >
      {Array.from({ length: Math.max(1, lines) }).map((_, i, arr) => (
        <Skeleton key={i} className={cn('h-3', i === arr.length - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export interface SkeletonCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Mostra um avatar circular à esquerda (ex.: item de lista com foto). */
  media?: boolean;
  /** Linhas de texto no corpo do card. */
  lines?: number;
  label?: string;
}

/**
 * Card em carregamento com a forma do shell (borda + padding do Card real),
 * evitando CLS quando o conteúdo chega.
 */
export function SkeletonCard({
  media = true,
  lines = 2,
  label = 'Carregando',
  className,
  ...props
}: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-surface p-4',
        className,
      )}
      {...props}
    >
      {media && <Skeleton className="size-10 shrink-0 rounded-sm" />}
      <div className="flex flex-1 flex-col gap-2">
        {Array.from({ length: Math.max(1, lines) }).map((_, i, arr) => (
          <Skeleton key={i} className={cn('h-3', i === arr.length - 1 ? 'w-4/5' : 'w-2/5')} />
        ))}
      </div>
    </div>
  );
}
