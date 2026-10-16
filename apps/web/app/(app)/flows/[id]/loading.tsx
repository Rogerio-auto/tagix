import { EDITOR_BLEED } from '@/features/flow-builder/shared/layout';
import { CanvasSkeleton } from '@/shared/components/feedback';

/**
 * Loading da rota `/flows/[id]` (F10-S10 / UX §3.6). Ocupa a área do editor enquanto
 * o segmento e o chunk do canvas `@xyflow/react` carregam — sem tela branca. Mesma
 * geometria de borda a borda do editor (F72-S07), para não pular na troca.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className={EDITOR_BLEED}>
      <CanvasSkeleton />
    </div>
  );
}
