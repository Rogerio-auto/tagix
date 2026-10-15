'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatMoney, stageAge } from './format';
import { StageMoveMenu } from './StageMoveMenu';
import { moveShortcut, type MoveDirection } from './stageMove';
import type { Deal, Stage } from './types';

export interface DealCardProps {
  deal: Deal;
  /** Etapas do funil (destinos do menu "Mover para etapa"). */
  stages: readonly Stage[];
  onOpen?: (dealId: string) => void;
  /** Mover sem arrastar: menu do card (destino escolhido). */
  onMove?: (dealId: string, toStageId: string) => void;
  /** Mover sem arrastar: atalho Shift + ←/→ (etapa vizinha). */
  onMoveStep?: (dealId: string, dir: MoveDirection) => void;
  /** Relógio compartilhado do board (ms) — base do "tempo na etapa". */
  nowMs: number;
  /** Modo só leitura (trial vencido): o card abre, mas não arrasta nem move. */
  disabled?: boolean;
  /** Acabou de chegar a esta etapa: assenta com o State morph. */
  settled?: boolean;
}

/**
 * Conteúdo visual do deal (maquete "Pipeline": título, tempo na etapa, valor em mono).
 * Presentacional: o mesmo markup serve o card na coluna e o `DragOverlay`.
 *
 * Movimento (DS 3.0 §05): hover = Lift (sobe 2px e inclina 0,3°); arrastar = no ar na
 * hora (escala, inclinação, borda de marca e sombra 3); soltar = State morph — o card
 * chega aceso (borda de marca + halo) e assenta no repouso pela transição de borda/sombra.
 * Sob `prefers-reduced-motion` nada se desloca: só a cor muda.
 */
export function DealCardView({
  deal,
  nowMs,
  lifted = false,
  placeholder = false,
  settled = false,
}: {
  deal: Deal;
  nowMs: number;
  /** No ar durante o drag (overlay): escala, sombra e borda de marca respondem na hora. */
  lifted?: boolean;
  /** Origem do drag: vira um vazio tracejado enquanto o card viaja. */
  placeholder?: boolean;
  settled?: boolean;
}): React.JSX.Element {
  const age = stageAge(deal, nowMs);
  const hasValue = deal.valueCents > 0;
  return (
    <div
      data-settled={settled || undefined}
      data-lifted={lifted || undefined}
      className={cn(
        'flex flex-col gap-2.5 rounded-md border bg-surface p-3',
        'transition-[transform,box-shadow,border-color,opacity] duration-(--dur-base) ease-ds motion-reduce:transition-none',
        lifted
          ? 'scale-[1.02] -rotate-1 cursor-grabbing border-border-brand shadow-ds-3 motion-reduce:scale-100 motion-reduce:rotate-0'
          : 'cursor-grab border-border hover:border-border-brand hover:shadow-ds-2 motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-[-0.3deg]',
        settled && 'border-border-brand shadow-glow',
        placeholder && 'border-dashed border-border-2 opacity-40 shadow-none',
      )}
    >
      {/* `pr-7` (`pr-11` no toque): o botão "Mover para etapa" ocupa o canto superior direito. */}
      <p className="line-clamp-2 pr-7 pointer-coarse:pr-11 font-body text-sm font-bold leading-snug text-text">{deal.title}</p>
      {hasValue || age ? (
        <div className="flex items-end justify-between gap-2">
          {hasValue ? (
            <span className="font-mono text-sm font-semibold tabular-nums text-brand-text">
              {formatMoney(deal.valueCents, deal.currency)}
            </span>
          ) : (
            <span />
          )}
          {age ? (
            <span
              title={`Na etapa há ${age.long}`}
              className={cn(
                'inline-flex items-center gap-1 font-mono text-xs tabular-nums',
                age.stale ? 'text-warn' : 'text-text-low',
              )}
            >
              <Clock className="size-3" aria-hidden />
              <span aria-hidden>{age.short}</span>
              <span className="sr-only">na etapa há {age.long}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Card arrastável do kanban (F5-S09, PIPELINE.md §9.2). dnd-kit sortable.
 *
 * Estrutura sem controle aninhado (axe `nested-interactive`): o nó sortable é um contêiner
 * neutro; dentro dele, lado a lado, o card (role=button: abrir e arrastar) e o botão do
 * menu "Mover para etapa".
 */
export function DealCard({
  deal,
  stages,
  onOpen,
  onMove,
  onMoveStep,
  nowMs,
  disabled = false,
  settled = false,
}: DealCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stageId: deal.stageId },
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const valueLabel = deal.valueCents > 0 ? `, valor ${formatMoney(deal.valueCents, deal.currency)}` : '';
  const canMove = !disabled && Boolean(onMove);

  return (
    <div ref={setNodeRef} style={style} data-deal-id={deal.id} className="group/deal relative">
      <div
        {...attributes}
        {...listeners}
        // `useSortable({ disabled })` injeta aria-disabled="true", mas o card segue abrindo
        // no clique/Enter (só leitura só tira o arrastar): não anunciar como desabilitado.
        aria-disabled={undefined}
        // §2.1: o corpo do card é a ação primária (abrir). Mouse: clique abre.
        // Teclado: Enter abre; Espaço (KeyboardSensor do dnd-kit) pega para arrastar;
        // Shift + ←/→ move direto para a etapa vizinha.
        role="button"
        aria-roledescription="negócio arrastável"
        aria-label={`Negócio ${deal.title}${valueLabel}`}
        aria-keyshortcuts={canMove ? 'Shift+ArrowLeft Shift+ArrowRight' : undefined}
        className="touch-none rounded-md outline-none focus-visible:focus-ring"
        onClick={() => onOpen?.(deal.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onOpen?.(deal.id);
            return;
          }
          const dir = canMove ? moveShortcut(e) : null;
          if (dir !== null) {
            e.preventDefault();
            onMoveStep?.(deal.id, dir);
            return;
          }
          // Espaço/setas seguem para o KeyboardSensor (arrastar pelo teclado).
          listeners?.['onKeyDown']?.(e);
        }}
      >
        <DealCardView deal={deal} nowMs={nowMs} placeholder={isDragging} settled={settled} />
      </div>
      {canMove && onMove && !isDragging ? (
        <StageMoveMenu
          deal={deal}
          stages={stages}
          onMove={(toStageId) => onMove(deal.id, toStageId)}
          // Discreto em repouso; aparece no hover/foco do card e quando aberto. Sempre no
          // DOM e focável (Tab chega nele mesmo invisível; ao focar, aparece).
          className="absolute right-2 top-2 opacity-0 focus-visible:opacity-100 aria-expanded:opacity-100 group-hover/deal:opacity-100 group-focus-within/deal:opacity-100 pointer-coarse:opacity-100"
        />
      ) : null}
    </div>
  );
}
