/**
 * Lógica PURA da visão "Lista" da Agenda Central (F54-S03). Sem React, sem I/O —
 * recebe um `nowMs` injetável para ser 100% determinística e testável.
 *
 * Regras (AGENDA_SYNC.md §3 / UX §3.9):
 *  - Agrupa os compromissos por DIA local, ordenando os grupos do mais antigo ao
 *    mais futuro (o passado vencido sobe ao topo — é o que mais pede ação).
 *  - Dentro do dia, ordena por horário crescente (o mais iminente primeiro).
 *  - **Vencido** = status não-terminal cujo horário de início já passou.
 *  - Em dias passados, só mantém vencidos (follow-ups em aberto): histórico concluído
 *    seria ruído numa lista de ação. Hoje/futuro mantêm tudo, menos cancelados.
 */

import type { EventRow } from './types';

const DAY_MS = 86_400_000;

/** Status terminais (não pedem mais ação). */
const TERMINAL: ReadonlySet<string> = new Set<string>(['completed', 'cancelled']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/** Início do dia local (00:00) em ms para um instante qualquer. */
export function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `true` se o compromisso é não-terminal e seu horário de início já passou. */
export function isOverdue(event: Pick<EventRow, 'status' | 'startAt'>, nowMs: number): boolean {
  if (isTerminalStatus(event.status)) return false;
  const start = new Date(event.startAt).getTime();
  return Number.isFinite(start) && start < nowMs;
}

export type DayRelative = 'past' | 'yesterday' | 'today' | 'tomorrow' | 'future';

/** Posição de um dia (00:00 ms) relativa a "agora". */
export function dayRelative(dayMs: number, nowMs: number): DayRelative {
  const diff = Math.round((dayMs - startOfDayMs(nowMs)) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff < 0 ? 'past' : 'future';
}

export interface AgendaListItem {
  readonly event: EventRow;
  /** `startAt` em ms (ordenação barata e estável). */
  readonly startMs: number;
  /** Vencido (passado + não-terminal). */
  readonly overdue: boolean;
}

export interface AgendaDayGroup {
  /** Chave estável do grupo (00:00 ms como string). */
  readonly key: string;
  /** 00:00 local do dia em ms. */
  readonly dayMs: number;
  readonly relative: DayRelative;
  /** `true` se o grupo contém ao menos um item vencido. */
  readonly overdue: boolean;
  readonly items: AgendaListItem[];
}

/**
 * Filtra os eventos relevantes para a lista: descarta cancelados; em dias passados
 * mantém só não-terminais (vencidos), evitando ruído de histórico concluído.
 */
export function selectAgendaEvents(events: readonly EventRow[], nowMs: number): EventRow[] {
  const todayStart = startOfDayMs(nowMs);
  return events.filter((e) => {
    if (e.status === 'cancelled') return false;
    const start = new Date(e.startAt).getTime();
    if (!Number.isFinite(start)) return false;
    if (startOfDayMs(start) < todayStart) return !isTerminalStatus(e.status);
    return true;
  });
}

/** Agrupa por dia local (grupos asc), ordenando itens por horário (asc, id como desempate). */
export function groupAgendaByDay(events: readonly EventRow[], nowMs: number): AgendaDayGroup[] {
  const byDay = new Map<number, AgendaListItem[]>();
  for (const event of events) {
    const startMs = new Date(event.startAt).getTime();
    if (!Number.isFinite(startMs)) continue;
    const dayMs = startOfDayMs(startMs);
    const item: AgendaListItem = { event, startMs, overdue: isOverdue(event, nowMs) };
    const bucket = byDay.get(dayMs);
    if (bucket) bucket.push(item);
    else byDay.set(dayMs, [item]);
  }

  const groups: AgendaDayGroup[] = [];
  for (const [dayMs, items] of byDay) {
    items.sort((a, b) => a.startMs - b.startMs || a.event.id.localeCompare(b.event.id));
    groups.push({
      key: String(dayMs),
      dayMs,
      relative: dayRelative(dayMs, nowMs),
      overdue: items.some((i) => i.overdue),
      items,
    });
  }
  groups.sort((a, b) => a.dayMs - b.dayMs);
  return groups;
}

/** Pipeline completo: seleciona os relevantes e agrupa por dia. */
export function buildAgendaList(events: readonly EventRow[], nowMs: number): AgendaDayGroup[] {
  return groupAgendaByDay(selectAgendaEvents(events, nowMs), nowMs);
}
