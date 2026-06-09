import { cn } from '@/shared/lib/cn';

/** Bloco de carregamento (UX §2.7/§3.6). Pulsa só com motion permitido. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('motion-safe:animate-pulse rounded-sm bg-surface-3', className)}
    />
  );
}

/** Lista de cards skeleton (ex.: ChatList carregando). */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border border-border-2 p-3">
          <Skeleton className="size-10 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
