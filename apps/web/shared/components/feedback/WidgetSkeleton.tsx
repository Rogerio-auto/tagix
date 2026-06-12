import { Skeleton } from './Skeleton';

/**
 * Skeletons de carregamento para os widgets pesados que viram lazy boundaries
 * (UX §3.6 — nunca tela branca). Cada um aproxima a "forma" do widget para evitar
 * layout shift (CLS) quando o chunk hidrata.
 */

/** Placeholder do canvas do Flow Builder (@xyflow/react). Ocupa a altura útil. */
export function CanvasSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex h-full min-h-[24rem] w-full items-center justify-center bg-surface-1"
      aria-busy
      aria-label="Carregando editor de flow"
    >
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-12 rounded-pill" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}

/** Placeholder de um card de gráfico (recharts). Combina com o ChartCard do dashboard. */
export function ChartSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex h-40 w-full items-end gap-2 px-2 pb-2"
      aria-busy
      aria-label="Carregando gráfico"
    >
      {(['h-[40%]', 'h-[70%]', 'h-[55%]', 'h-[90%]', 'h-[35%]', 'h-[65%]', 'h-[50%]'] as const).map(
        (h, i) => (
          <Skeleton key={i} className={`flex-1 rounded-sm ${h}`} />
        ),
      )}
    </div>
  );
}

/** Placeholder do calendário (@fullcalendar) — grade mensal. */
export function CalendarSkeleton(): React.JSX.Element {
  return (
    <div className="w-full" aria-busy aria-label="Carregando agenda">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-none" />
        ))}
      </div>
    </div>
  );
}

/** Placeholder de um board/colunas com cards arrastáveis (@dnd-kit) — ex.: pipeline. */
export function BoardSkeleton({ columns = 4 }: { columns?: number }): React.JSX.Element {
  return (
    <div className="flex gap-4 overflow-hidden" aria-busy aria-label="Carregando board">
      {Array.from({ length: columns }).map((_, c) => (
        <div key={c} className="flex w-72 flex-col gap-3">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 3 }).map((_, r) => (
            <Skeleton key={r} className="h-24 w-full rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}
