import type { Deal, Stage } from './types';

/**
 * Regras puras de "mover o negócio de etapa", fonte única de três caminhos equivalentes
 * (WCAG 2.1.1 teclado e 2.5.7 movimento de arrastar):
 *
 * 1. arrastar com o mouse (dnd-kit, PointerSensor);
 * 2. arrastar pelo teclado (dnd-kit, KeyboardSensor: Espaço pega, setas movem, Espaço solta);
 * 3. sem arrastar: menu "Mover para etapa" no card e o atalho Shift + ←/→ (etapa vizinha).
 *
 * A checagem de `transitionRules` aqui é o espelho client-side de PIPELINE §4.2 (só
 * `allowedFromStageIds`); a checagem completa é server-side e autoritativa.
 */

export type MoveDirection = -1 | 1;

/** Etapas na ordem do funil (por `position`), sem mutar a entrada. */
export function orderedStages(stages: readonly Stage[]): Stage[] {
  return [...stages].sort((a, b) => a.position - b.position);
}

/** `true` se a regra de transição de `to` não aceita vir de `fromStageId`. */
export function isTransitionBlocked(to: Stage, fromStageId: string): boolean {
  const allowed = to.transitionRules?.allowedFromStageIds ?? [];
  return allowed.length > 0 && !allowed.includes(fromStageId);
}

/** Motivo legível do bloqueio (para o toast), ou `null` se o movimento é permitido. */
export function transitionBlockedReason(
  stages: readonly Stage[],
  deal: Pick<Deal, 'stageId'>,
  toStageId: string,
): string | null {
  const to = stages.find((s) => s.id === toStageId);
  if (!to) return null;
  return isTransitionBlocked(to, deal.stageId)
    ? `Não é permitido mover para "${to.name}" a partir da etapa atual.`
    : null;
}

export interface MoveOption {
  readonly stage: Stage;
  /** Etapa em que o negócio já está (item desabilitado, marcado "Atual"). */
  readonly current: boolean;
  /** Regra de transição recusa esta etapa a partir da atual. */
  readonly blocked: boolean;
}

/** Opções do menu "Mover para etapa", na ordem do funil. */
export function moveOptions(stages: readonly Stage[], deal: Pick<Deal, 'stageId'>): MoveOption[] {
  return orderedStages(stages).map((stage) => {
    const current = stage.id === deal.stageId;
    return { stage, current, blocked: !current && isTransitionBlocked(stage, deal.stageId) };
  });
}

/**
 * Etapa vizinha na direção pedida, pulando as que a regra de transição bloqueia.
 * `null` nas pontas do funil ou quando nada adiante aceita o negócio.
 */
export function adjacentStageId(
  stages: readonly Stage[],
  deal: Pick<Deal, 'stageId'>,
  dir: MoveDirection,
): string | null {
  const ordered = orderedStages(stages);
  const from = ordered.findIndex((s) => s.id === deal.stageId);
  if (from === -1) return null;
  for (let i = from + dir; i >= 0 && i < ordered.length; i += dir) {
    const candidate = ordered[i];
    if (candidate && !isTransitionBlocked(candidate, deal.stageId)) return candidate.id;
  }
  return null;
}

/** Forma mínima do evento de teclado (testável sem DOM). */
export interface MoveKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Atalho de mover sem arrastar: **Shift + →** avança uma etapa, **Shift + ←** volta.
 * Alt + seta fica de fora de propósito (é "voltar/avançar página" no navegador), e
 * Ctrl/Cmd também (atalhos do sistema).
 */
export function moveShortcut(e: MoveKeyEvent): MoveDirection | null {
  if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === 'ArrowRight') return 1;
  if (e.key === 'ArrowLeft') return -1;
  return null;
}

/**
 * Foco itinerante do menu (padrão WAI-ARIA "menu"): ↓/↑ andam pulando itens
 * desabilitados e dão a volta; Home/End vão às pontas. Devolve o índice novo, ou
 * `null` se a tecla não é de navegação ou não há item habilitado.
 */
export function nextMenuIndex(
  enabled: readonly boolean[],
  current: number,
  key: string,
): number | null {
  const n = enabled.length;
  if (n === 0 || !enabled.some(Boolean)) return null;
  const firstFrom = (start: number, step: 1 | -1): number => {
    for (let k = 0, i = start; k < n; k += 1, i = (i + step + n) % n) {
      if (enabled[i]) return i;
    }
    return start;
  };
  switch (key) {
    case 'ArrowDown':
      return firstFrom(current < 0 ? 0 : (current + 1) % n, 1);
    case 'ArrowUp':
      return firstFrom(current < 0 ? n - 1 : (current - 1 + n) % n, -1);
    case 'Home':
      return firstFrom(0, 1);
    case 'End':
      return firstFrom(n - 1, -1);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Drag multi-container (padrão dnd-kit "multiple containers")
//
// Durante o arrasto o board é desenhado a partir de um estado LOCAL (ids por etapa): o
// placeholder viaja para a coluna sob o cursor em `onDragOver`, então o card ativo segue o
// cursor de coluna em coluna. Fora do arrasto NÃO existe ordem local: o board é sempre
// `groupDealIds` (ordem do servidor + movimentos pendentes). Ao soltar, o card já ocupa o
// lugar que o servidor vai lhe dar (topo da etapa, `position: 0`) e o DragOverlay voa até
// lá — o refetch confirma a mesma ordem, sem salto.
// ---------------------------------------------------------------------------

/** Ids dos deals por etapa, na ordem exibida. */
export type BoardItems = Readonly<Record<string, readonly string[]>>;

/**
 * Movimentos já pedidos ao servidor e ainda não refletidos no cache (`dealId → stageId`):
 * ponte entre soltar o card e o update otimista chegar (a mutation é assíncrona). Um por
 * deal — dois movimentos rápidos não se atropelam.
 */
export type PendingMoves = ReadonlyMap<string, string>;

const NO_PENDING: PendingMoves = new Map();

/** Posição que o move-stage grava no deal movido (`apps/api/src/services/deal-move.ts`). */
export const MOVED_POSITION = 0;

type OrderedDeal = Pick<Deal, 'id' | 'stageId' | 'position' | 'createdAt'>;

/**
 * Ordem do servidor dentro de uma etapa — espelho de `GET /api/deals`
 * (`position asc, createdAt desc`). Empate total preserva a ordem de chegada (sort estável).
 */
export function compareServerOrder(a: OrderedDeal, b: OrderedDeal): number {
  if (a.position !== b.position) return a.position - b.position;
  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';
  return ca === cb ? 0 : ca < cb ? 1 : -1;
}

/**
 * Agrupa os deals por etapa (todas as etapas presentes, mesmo vazias), cada coluna na
 * ordem do servidor. Um movimento pendente já entra na etapa de destino, na posição que
 * o servidor vai gravar.
 */
export function groupDealIds(
  stages: readonly Pick<Stage, 'id'>[],
  deals: readonly OrderedDeal[],
  pending: PendingMoves = NO_PENDING,
): BoardItems {
  const cols: Record<string, OrderedDeal[]> = {};
  for (const s of stages) cols[s.id] = [];
  for (const d of deals) {
    const to = pending.get(d.id);
    const deal = to !== undefined && to !== d.stageId ? { ...d, stageId: to, position: MOVED_POSITION } : d;
    cols[deal.stageId]?.push(deal);
  }
  const out: Record<string, string[]> = {};
  for (const [stageId, col] of Object.entries(cols)) {
    out[stageId] = col.sort(compareServerOrder).map((d) => d.id);
  }
  return out;
}

/** Registra (ou substitui) o movimento pendente de um deal. */
export function setPending(pending: PendingMoves, dealId: string, stageId: string): PendingMoves {
  if (pending.get(dealId) === stageId) return pending;
  const next = new Map(pending);
  next.set(dealId, stageId);
  return next;
}

/**
 * Retira o movimento pendente de um deal — só se ainda for o mesmo destino (um movimento
 * mais novo do mesmo deal não é apagado pelo fim do anterior). Sem mudança: mesma referência.
 */
export function clearPending(pending: PendingMoves, dealId: string, stageId: string): PendingMoves {
  if (pending.get(dealId) !== stageId) return pending;
  const next = new Map(pending);
  next.delete(dealId);
  return next;
}

/**
 * Descarta os pendentes que o cache já reflete (ou cujo deal sumiu). Sem mudança: mesma
 * referência (o efeito que chama isto não entra em loop).
 */
export function prunePending(
  pending: PendingMoves,
  stageOf: (dealId: string) => string | undefined,
): PendingMoves {
  let next: Map<string, string> | null = null;
  for (const [dealId, stageId] of pending) {
    const current = stageOf(dealId);
    if (current === undefined || current === stageId) {
      next ??= new Map(pending);
      next.delete(dealId);
    }
  }
  return next ?? pending;
}

/** Update otimista do move-stage: mesma etapa/posição/`updatedAt` que o servidor grava. */
export function applyMove<T extends Pick<Deal, 'id' | 'stageId' | 'position' | 'updatedAt'>>(
  deals: readonly T[],
  dealId: string,
  stageId: string,
  movedAt: string,
): T[] {
  return deals.map((d) =>
    d.id === dealId ? { ...d, stageId, position: MOVED_POSITION, updatedAt: movedAt } : d,
  );
}

/**
 * Desfaz UM movimento que falhou, sem tocar nos outros deals (outro movimento em voo
 * continua de pé). Se o deal já foi movido de novo depois deste, nada muda.
 */
export function revertMove<T extends Pick<Deal, 'id' | 'stageId'>>(
  current: readonly T[],
  previous: readonly T[],
  dealId: string,
  failedStageId: string,
): T[] {
  const before = previous.find((d) => d.id === dealId);
  if (!before) return [...current];
  return current.map((d) => (d.id === dealId && d.stageId === failedStageId ? before : d));
}

/** Etapa que contém `id` — o próprio `id` se ele já é uma etapa. */
export function findContainer(items: BoardItems, id: string): string | undefined {
  if (Object.hasOwn(items, id)) return id;
  return Object.keys(items).find((key) => items[key]?.includes(id));
}

export interface MoveOverOptions {
  /** Inserir DEPOIS do item sob o cursor (metade de baixo dele). */
  readonly after?: boolean;
  /** Regra de transição: `false` mantém o item onde está. */
  readonly canEnter?: (toStageId: string) => boolean;
}

/**
 * Leva `activeId` para a etapa de `overId` (etapa ou item), na posição do item sob o
 * cursor (ou no fim, se o alvo é a própria etapa). Mesma etapa, alvo desconhecido ou
 * transição recusada devolvem `items` intacto (mesma referência: nenhum re-render).
 */
export function moveToContainer(
  items: BoardItems,
  activeId: string,
  overId: string,
  { after = false, canEnter }: MoveOverOptions = {},
): BoardItems {
  const from = findContainer(items, activeId);
  const to = findContainer(items, overId);
  if (!from || !to || from === to) return items;
  if (canEnter && !canEnter(to)) return items;
  const source = items[from] ?? [];
  const target = items[to] ?? [];
  const overIndex = target.indexOf(overId);
  const index = overIndex === -1 ? target.length : overIndex + (after ? 1 : 0);
  return {
    ...items,
    [from]: source.filter((id) => id !== activeId),
    [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
  };
}

/** Texto do anúncio (região viva) depois de um movimento por teclado ou menu. */
export function moveAnnouncement(dealTitle: string, stageName: string): string {
  return `"${dealTitle}" movido para a etapa "${stageName}".`;
}
