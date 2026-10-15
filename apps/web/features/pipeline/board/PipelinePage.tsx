'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus, Settings2, Tag } from 'lucide-react';
import { AnchoredHelpHint, Button, useToast } from '@hm/ui';
import { HelpHint } from '@/shared/components/help';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { READ_ONLY_TOOLTIP, useIsReadOnly } from '@/shared/components/account-banner/useIsReadOnly';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { StageColumn } from './StageColumn';
import { DealCardView } from './DealCard';
import { MobileBoard } from './MobileBoard';
import { MobileDealSheet } from './MobileDealSheet';
import { formatTotals, openDeals } from './format';
import {
  adjacentStageId,
  clearPending,
  findContainer,
  groupDealIds,
  moveAnnouncement,
  moveToContainer,
  prunePending,
  setPending,
  transitionBlockedReason,
  type BoardItems,
  type MoveDirection,
  type PendingMoves,
} from './stageMove';
import { useNow } from './useNow';
import { useDeals, usePipelineDetail, usePipelines, useMoveDeal } from './queries';
import { DealDetailDrawer } from '../deal';
import type { CustomFieldDef } from '../custom-fields';
import { useDealSocket } from './useDealSocket';
import { CreatePipelineModal } from '../settings/CreatePipelineModal';
import type { Deal } from './types';

/**
 * Curva de `--ease-spring` (packages/design-tokens/src/tokens.css). O dnd-kit anima pela
 * Web Animations API, que não resolve `var(--…)`: o valor é espelhado aqui, literal.
 * Mudou o token? Mude aqui.
 */
const EASE_SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Soltar: o card voa até o lugar em 200ms (DS 3.0 §05: feedback < 200ms). */
const DROP_ANIMATION = { duration: 200, easing: EASE_SPRING } as const;

interface MoveDealOptions {
  /** Veio do menu/atalho: anuncia na região viva e devolve o foco ao card. */
  readonly viaKeyboard?: boolean;
}

/** Contexto de UI de um movimento em voo (o erro de CADA movimento usa o seu). */
interface MoveInFlight {
  readonly stageId: string;
  readonly title: string;
  readonly viaKeyboard: boolean;
}

export function PipelinePage(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const readOnly = useIsReadOnly();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const nowMs = useNow();
  const pipelinesQuery = usePipelines();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [settledId, setSettledId] = useState<string | null>(null);
  const settleTimer = useRef<number | null>(null);
  // Movimento por teclado/menu: anúncio na região viva e foco que segue o card.
  const [liveMessage, setLiveMessage] = useState('');
  const [refocus, setRefocus] = useState<{ dealId: string; stageId: string } | null>(null);

  const pipelines = pipelinesQuery.data?.data ?? [];
  const meta = pipelinesQuery.data?.meta;
  const pipelineId = selectedId ?? pipelines[0]?.id;

  const detail = usePipelineDetail(pipelineId);
  const dealsQuery = useDeals(pipelineId);
  // Ponte entre soltar e o otimista chegar ao cache, um por deal (ver `PendingMoves`).
  const [pendingMoves, setPendingMoves] = useState<PendingMoves>(() => new Map());
  const inFlight = useRef(new Map<string, MoveInFlight>());
  const move = useMoveDeal(pipelineId ?? '', {
    onError: (err, { dealId, stageId }) => {
      const ctx = inFlight.current.get(dealId);
      const own = ctx?.stageId === stageId ? ctx : undefined;
      setSettledId((cur) => (cur === dealId ? null : cur));
      if (own?.viaKeyboard) {
        setRefocus((cur) => (cur?.dealId === dealId ? null : cur));
        setLiveMessage(`Não foi possível mover "${own.title}".`);
      }
      toast({ variant: 'error', title: err.message || 'Falha ao mover o negócio.' });
    },
    onSettled: ({ dealId, stageId }) => {
      if (inFlight.current.get(dealId)?.stageId === stageId) inFlight.current.delete(dealId);
      setPendingMoves((cur) => clearPending(cur, dealId, stageId));
    },
  });
  useDealSocket(pipelineId);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  // Paridade teclado↔mouse (UX §2.10): KeyboardSensor permite pegar (Espaço),
  // mover (setas) e soltar (Espaço) um deal entre stages sem mouse. PointerSensor
  // mantém o drag por mouse intacto (sem regressão).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const stages = useMemo(
    () => [...(detail.data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [detail.data],
  );
  const deals = useMemo(() => dealsQuery.data?.deals ?? [], [dealsQuery.data]);
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const s of stages) map.set(s.id, []);
    for (const d of deals) {
      const arr = map.get(d.stageId);
      if (arr) arr.push(d);
    }
    return map;
  }, [stages, deals]);

  // Board do desktop (drag multi-container). A ordem de cada coluna é a do SERVIDOR
  // (`groupDealIds`: position asc, createdAt desc), com os movimentos pendentes já no
  // destino. Só DURANTE o arrasto existe um estado local (`dragItems`): o placeholder segue
  // o cursor de coluna em coluna. Ao soltar ele é descartado e o card ocupa o lugar que o
  // servidor vai lhe dar — o DragOverlay voa direto para lá e o refetch não o move de novo.
  const serverItems = useMemo(
    () => groupDealIds(stages, deals, pendingMoves),
    [stages, deals, pendingMoves],
  );
  const [dragItems, setDragItems] = useState<BoardItems | null>(null);
  const items = dragItems ?? serverItems;

  // O cache já reflete o movimento (otimista ou servidor): a ponte não é mais necessária.
  useEffect(() => {
    setPendingMoves((cur) => prunePending(cur, (id) => dealById.get(id)?.stageId));
  }, [dealById]);

  const summary = useMemo(() => {
    if (stages.length === 0) return undefined;
    const open = openDeals(deals, stages);
    const total = formatTotals(open);
    const count = `${open.length} ${open.length === 1 ? 'negócio em aberto' : 'negócios em aberto'}`;
    // Maquete "Pipeline": o total em aberto é número — mono tabular, separado do rótulo.
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span>{count}</span>
        {total ? (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono font-semibold tabular-nums text-text">{total}</span>
          </>
        ) : null}
      </span>
    );
  }, [deals, stages]);

  // O card movido por teclado/menu remonta na coluna nova: devolve o foco a ele para
  // que o próximo Shift + → continue de onde parou (o foco não cai no <body>).
  // Espera o update otimista pôr o deal na etapa nova (o card antigo ainda existe até lá).
  useEffect(() => {
    if (!refocus) return;
    if (deals.find((d) => d.id === refocus.dealId)?.stageId !== refocus.stageId) return;
    const id = window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-stage-id="${CSS.escape(refocus.stageId)}"] [data-deal-id="${CSS.escape(refocus.dealId)}"] [role="button"]`,
      );
      el?.focus();
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      setRefocus(null);
    });
    return () => window.cancelAnimationFrame(id);
  }, [refocus, deals]);

  // Move um deal de stage com feedback de erro (§2.7). Fonte única reusada pelo
  // drag (desktop), pelo menu/atalho de teclado (desktop) e pelo "Mover para…" (mobile, §2.2).
  // Devolve `true` se a mutation foi disparada.
  const moveDeal = (
    dealId: string,
    toStageId: string,
    { viaKeyboard = false }: MoveDealOptions = {},
  ): boolean => {
    if (readOnly) {
      toast({ variant: 'warn', title: READ_ONLY_TOOLTIP });
      return false;
    }
    const deal = dealById.get(dealId);
    if (!deal || deal.stageId === toStageId) return false;
    const blocked = transitionBlockedReason(stages, deal, toStageId);
    if (blocked) {
      toast({ variant: 'warn', title: blocked });
      return false;
    }
    setSettledId(dealId);
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettledId(null), 700);
    if (viaKeyboard) {
      const to = stages.find((s) => s.id === toStageId);
      setLiveMessage(moveAnnouncement(deal.title, to?.name ?? 'etapa'));
      setRefocus({ dealId, stageId: toStageId });
    }
    // Erro e fim chegam pelos callbacks do hook (um por movimento, ver `useMoveDeal`).
    inFlight.current.set(dealId, { stageId: toStageId, title: deal.title, viaKeyboard });
    move.mutate({ dealId, stageId: toStageId });
    return true;
  };

  // Shift + ←/→ no card: etapa vizinha (pulando as que a regra de transição recusa).
  const moveDealStep = (dealId: string, dir: MoveDirection): void => {
    const deal = dealById.get(dealId);
    if (!deal) return;
    const to = adjacentStageId(stages, deal, dir);
    if (!to) {
      setLiveMessage(dir === 1 ? 'Já está na última etapa disponível.' : 'Já está na primeira etapa disponível.');
      return;
    }
    moveDeal(dealId, to, { viaKeyboard: true });
  };

  function onDragStart(event: DragStartEvent): void {
    setDragItems(serverItems);
    setActiveDragId(String(event.active.id));
  }

  // O placeholder viaja para a coluna sob o cursor — exceto as que a regra de transição
  // recusa a partir da etapa de ORIGEM (a origem sempre aceita a volta).
  function onDragOver({ active, over }: DragOverEvent): void {
    if (!over) return;
    const deal = dealById.get(String(active.id));
    if (!deal) return;
    const translated = active.rect.current.translated;
    const after = translated !== null && translated.top > over.rect.top + over.rect.height / 2;
    setDragItems((prev) =>
      moveToContainer(prev ?? serverItems, deal.id, String(over.id), {
        after,
        canEnter: (to) => to === deal.stageId || transitionBlockedReason(stages, deal, to) === null,
      }),
    );
  }

  /** Fim do arrasto: some o estado local — o board volta à ordem do servidor. */
  function endDrag(): void {
    setDragItems(null);
    setActiveDragId(null);
  }

  function onDragEnd({ active, over }: DragEndEvent): void {
    endDrag();
    const deal = dealById.get(String(active.id));
    if (!over || !deal) return;
    // Soltou sobre uma etapa que a regra recusa (o placeholder nem entrou): avisa e volta.
    const overStage = findContainer(items, String(over.id));
    if (overStage && overStage !== deal.stageId) {
      const blocked = transitionBlockedReason(stages, deal, overStage);
      if (blocked) {
        toast({ variant: 'warn', title: blocked });
        return;
      }
    }
    // O destino é a coluna onde o placeholder está AGORA. No mesmo render o pendente põe
    // o card no lugar que o servidor vai lhe dar, e o overlay anima até esse nó.
    const toStageId = findContainer(items, deal.id);
    if (!toStageId || toStageId === deal.stageId) return;
    if (moveDeal(deal.id, toStageId)) {
      setPendingMoves((cur) => setPending(cur, deal.id, toStageId));
    }
  }

  function onDragCancel(): void {
    endDrag();
  }

  const columnDeals = (stageId: string): Deal[] =>
    (items[stageId] ?? []).flatMap((id) => {
      const d = dealById.get(id);
      return d ? [d] : [];
    });

  const dealTitle = (id: string | number): string => dealById.get(String(id))?.title ?? 'negócio';
  // Etapa pelo estado local (o card ativo já pode estar na coluna nova).
  const stageName = (id: string | number): string => {
    const sid = findContainer(items, String(id));
    return stages.find((s) => s.id === sid)?.name ?? 'etapa';
  };

  // Anúncios aria-live do drag por teclado (acessibilidade do dnd — UX §2.10):
  // o usuário ouve o que pegou, sobre qual etapa está e onde soltou.
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Negócio "${dealTitle(active.id)}" selecionado. Use as setas para mover entre etapas e Espaço para soltar.`,
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      return `"${dealTitle(active.id)}" sobre a etapa "${stageName(over.id)}".`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return `Movimentação de "${dealTitle(active.id)}" cancelada.`;
      return `"${dealTitle(active.id)}" solto na etapa "${stageName(over.id)}".`;
    },
    onDragCancel: ({ active }) =>
      `Movimentação de "${dealTitle(active.id)}" cancelada; permanece na etapa atual.`,
  };

  const screenReaderInstructions = {
    draggable:
      'Enter abre o negócio. Espaço pega o card; use as setas para escolher a etapa e Espaço ' +
      'para soltar, ou Esc para cancelar. Shift mais seta para a direita ou para a esquerda ' +
      'move direto para a etapa vizinha. O botão ao lado do card abre o menu Mover para etapa.',
  };

  const createModal = (
    <CreatePipelineModal
      open={showCreate}
      onClose={() => setShowCreate(false)}
      onCreated={(newId) => {
        setShowCreate(false);
        setSelectedId(newId);
      }}
    />
  );

  if (pipelinesQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col" aria-busy aria-label="Carregando pipeline">
        <PageHeader title="Pipeline" />
        <BoardLoading isMobile={isMobile} />
      </div>
    );
  }

  if (pipelinesQuery.isError) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Pipeline" />
        <ErrorState
          error={pipelinesQuery.error}
          title="Não foi possível carregar suas pipelines"
          action={
            <Button variant="secondary" size="sm" onClick={() => void pipelinesQuery.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Pipeline" />
        <EmptyState
          icon={Tag}
          title="Nenhuma pipeline criada ainda"
          description="Crie sua primeira pipeline de vendas para começar a organizar seus negócios."
          action={
            <Button
              onClick={() => setShowCreate(true)}
              disabled={readOnly}
              title={readOnly ? READ_ONLY_TOOLTIP : undefined}
              leftIcon={<Plus className="size-4" aria-hidden />}
            >
              Criar pipeline
            </Button>
          }
        />
        {createModal}
      </div>
    );
  }

  const atLimit = meta ? meta.current >= meta.limit : false;
  const createBlockedReason = readOnly
    ? READ_ONLY_TOOLTIP
    : atLimit && meta
      ? `Limite de ${meta.limit} pipelines atingido. Exclua uma para criar outra.`
      : undefined;
  const activeDeal = activeDragId ? (dealById.get(activeDragId) ?? null) : null;
  const customFieldDefs =
    (detail.data?.pipeline.settings.custom_fields as CustomFieldDef[] | undefined) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Pipeline"
        description={summary}
        helpSlot={
          <>
            <HelpHint k="pipeline.board" />
            <AnchoredHelpHint anchorKey="pipeline.board" />
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-2" data-tour-id="pipeline-selector">
              <select
                value={pipelineId}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Selecionar pipeline"
                className="h-10 rounded-md border border-border bg-surface px-3 font-body text-sm font-bold text-text outline-none transition-colors hover:border-border-2 focus-visible:focus-ring"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {meta && pipelines.length >= 2 && (
                <span className="font-mono text-xs tabular-nums text-text-low">
                  {meta.current}/{meta.limit}
                </span>
              )}
            </div>
            <Link
              href="/pipeline/settings"
              aria-label="Configurar pipeline"
              title="Configurar pipeline"
              className="grid size-10 place-items-center rounded-md border border-border text-text-mid outline-none transition-colors hover:border-border-2 hover:text-text focus-visible:focus-ring"
            >
              <Settings2 className="size-4" aria-hidden />
            </Link>
            <Button
              variant="secondary"
              onClick={() => setShowCreate(true)}
              disabled={atLimit || readOnly}
              title={createBlockedReason}
              leftIcon={<Plus className="size-4" aria-hidden />}
            >
              Nova pipeline
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col" data-tour-id="pipeline-board">
        {detail.isLoading || dealsQuery.isLoading ? (
          <BoardLoading isMobile={isMobile} />
        ) : detail.isError || dealsQuery.isError ? (
          <ErrorState
            error={detail.error ?? dealsQuery.error}
            title="Não foi possível carregar o funil"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void detail.refetch();
                  void dealsQuery.refetch();
                }}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : isMobile ? (
          // Mobile: kanban horizontal+drag é inviável no toque → seletor de estágio
          // + lista vertical + mover por ação explícita (MOBILE_UX §2 "Kanban").
          <MobileBoard
            stages={stages}
            dealsByStage={dealsByStage}
            onOpenDeal={setOpenDealId}
            onMoveDeal={(dealId, toStageId) => {
              moveDeal(dealId, toStageId);
            }}
            nowMs={nowMs}
            readOnly={readOnly}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            accessibility={{ announcements, screenReaderInstructions }}
          >
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
              {stages.map((stage) => (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  stages={stages}
                  deals={columnDeals(stage.id)}
                  onOpenDeal={setOpenDealId}
                  onMoveDeal={(dealId, toStageId) => {
                    moveDeal(dealId, toStageId, { viaKeyboard: true });
                  }}
                  onMoveDealStep={moveDealStep}
                  nowMs={nowMs}
                  disabled={readOnly}
                  settledDealId={settledId}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
              {activeDeal ? <DealCardView deal={activeDeal} nowMs={nowMs} lifted /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Anúncio dos movimentos por menu/atalho (o drag tem os anúncios do dnd-kit). */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {createModal}

      {isMobile ? (
        <MobileDealSheet
          dealId={openDealId}
          canEdit
          customFieldDefs={customFieldDefs}
          onClose={() => setOpenDealId(null)}
        />
      ) : (
        <DealDetailDrawer
          dealId={openDealId}
          canEdit
          customFieldDefs={customFieldDefs}
          onClose={() => setOpenDealId(null)}
        />
      )}
    </div>
  );
}

/** Esqueleto com a forma do board: colunas com cabeçalho e cards (sem CLS). */
function BoardLoading({ isMobile }: { isMobile: boolean }): React.JSX.Element {
  if (isMobile) {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-28 rounded-pill" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-md" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex w-72 shrink-0 flex-col gap-2 xl:w-80">
          <Skeleton className="h-4 w-24" />
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-inset p-2">
            {[0, 1, 2].slice(0, 3 - (i % 2)).map((j) => (
              <Skeleton key={j} className="h-20 rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
