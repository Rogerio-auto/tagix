import { CanvasSkeleton } from '@/shared/components/feedback';

/**
 * Loading da rota `/flows/[id]` (F10-S10 / UX §3.6). Ocupa a área do editor enquanto
 * o segmento e o chunk do canvas `@xyflow/react` carregam — sem tela branca.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <CanvasSkeleton />
    </div>
  );
}
