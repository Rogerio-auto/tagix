/**
 * Recorrência de eventos (Calendar 2.0, F37-S02) — serviço PURO e testável.
 *
 * O modelo de recorrência é um RRULE simplificado (D1 do CALENDAR_V2_PLAN):
 *
 *   FREQ=DAILY[;INTERVAL=n][;UNTIL=ISO]
 *   FREQ=WEEKLY[;INTERVAL=n][;BYDAY=MO,WE,FR][;UNTIL=ISO]
 *
 * - `FREQ` é obrigatório (DAILY|WEEKLY).
 * - `INTERVAL` (inteiro >= 1) define o espaçamento entre ocorrências (default 1).
 * - `BYDAY` (só WEEKLY) seleciona dias da semana (MO,TU,WE,TH,FR,SA,SU). Ausente em
 *   WEEKLY = o dia da semana do `startAt` do mestre.
 * - `UNTIL` é o limite inclusivo da série (ISO datetime). Também aceito fora do RRULE
 *   via coluna `recurrenceUntil`; o efetivo é o mais cedo entre os dois.
 *
 * `expandOccurrences(event, from, to)` materializa as ocorrências da janela `[from, to]`
 * (interseção de evento com a janela; clamp de segurança no nº de instâncias). Cada
 * ocorrência é um clone do evento com `startAt`/`endAt` deslocados, e um id sintético
 * `evt:<masterId>:<occurrenceStartISO>` — permite o front abrir uma instância e editar
 * a SÉRIE (v1: edição/cancelamento aplicam à série inteira).
 *
 * O passo é feito em UTC (dia/semana ancorados em UTC) — determinístico independente do
 * fuso do processo e alinhado ao armazenamento timestamptz. A duração de cada ocorrência
 * espelha a do mestre (avança o instante exato em múltiplos de 24h).
 *
 * Sem dependências de DB: recebe e devolve POJOs. Os campos de recorrência (`recurrenceRule`,
 * `recurrenceUntil`, `recurrenceParentId`) são tipados estruturalmente para não acoplar ao
 * schema do Drizzle.
 */

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** Teto duro de ocorrências por evento numa janela — evita expansão patológica. */
const MAX_OCCURRENCES = 1000;

export type RecurrenceFreq = 'DAILY' | 'WEEKLY';

export interface ParsedRecurrence {
  readonly freq: RecurrenceFreq;
  /** Intervalo entre ocorrências (>= 1). */
  readonly interval: number;
  /** Dias da semana (0=Dom..6=Sáb). Vazio = derivar do startAt (WEEKLY) ou n/a (DAILY). */
  readonly byDay: readonly number[];
  /** Limite inclusivo embutido no RRULE (UNTIL=...). null se ausente. */
  readonly until: Date | null;
}

/** Forma mínima de um evento para a expansão (estrutural, não acopla ao Drizzle). */
export interface RecurringEventLike {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly recurrenceRule: string | null;
  readonly recurrenceUntil: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function weekdayToIndex(code: string): number {
  const idx = WEEKDAY_CODES.indexOf(code.trim().toUpperCase() as WeekdayCode);
  return idx;
}

/**
 * Faz o parse do RRULE simplificado. Retorna null para regra ausente/vazia ou inválida
 * (a chamada trata "inválido" como "evento simples" — defensivo: nunca lança).
 */
export function parseRecurrenceRule(rule: string | null | undefined): ParsedRecurrence | null {
  if (typeof rule !== 'string') return null;
  const trimmed = rule.trim();
  if (trimmed === '') return null;

  const parts = new Map<string, string>();
  for (const segment of trimmed.split(';')) {
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const key = segment.slice(0, eq).trim().toUpperCase();
    const value = segment.slice(eq + 1).trim();
    if (key) parts.set(key, value);
  }

  const freqRaw = parts.get('FREQ')?.toUpperCase();
  if (freqRaw !== 'DAILY' && freqRaw !== 'WEEKLY') return null;
  const freq: RecurrenceFreq = freqRaw;

  let interval = 1;
  const intervalRaw = parts.get('INTERVAL');
  if (intervalRaw !== undefined) {
    const n = Number.parseInt(intervalRaw, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    interval = n;
  }

  let byDay: number[] = [];
  const byDayRaw = parts.get('BYDAY');
  if (byDayRaw !== undefined && byDayRaw !== '') {
    const indices: number[] = [];
    for (const code of byDayRaw.split(',')) {
      const idx = weekdayToIndex(code);
      if (idx < 0) return null;
      if (!indices.includes(idx)) indices.push(idx);
    }
    byDay = indices.sort((a, b) => a - b);
  }

  let until: Date | null = null;
  const untilRaw = parts.get('UNTIL');
  if (untilRaw !== undefined && untilRaw !== '') {
    const d = new Date(untilRaw);
    if (Number.isNaN(d.getTime())) return null;
    until = d;
  }

  return { freq, interval, byDay, until };
}

/** id sintético de uma ocorrência: evt:<masterId>:<occurrenceStartISO>. */
export function occurrenceId(masterId: string, occurrenceStart: Date): string {
  return `evt:${masterId}:${occurrenceStart.toISOString()}`;
}

/** Limite efetivo da série: o mais cedo entre UNTIL (RRULE) e recurrenceUntil (coluna). */
function effectiveUntil(parsed: ParsedRecurrence, columnUntil: Date | null): Date | null {
  if (parsed.until && columnUntil) {
    return parsed.until.getTime() <= columnUntil.getTime() ? parsed.until : columnUntil;
  }
  return parsed.until ?? columnUntil ?? null;
}

/**
 * Expande as ocorrências de um evento recorrente que INTERSECTAM a janela `[from, to]`.
 *
 * - Evento sem `recurrenceRule` (ou regra inválida) → `[event]` se intersecta a janela,
 *   senão `[]` (mantém o filtro de janela consistente com a query do mestre simples).
 * - Cada ocorrência preserva a duração do mestre (endAt - startAt).
 * - Os ids sintéticos apontam o mestre; o `recurrenceParentId` da instância aponta o mestre.
 *
 * `EventOut` é genérico no shape de entrada: devolve o mesmo objeto com `id`, `startAt`,
 * `endAt`, `recurrenceParentId` recalculados por ocorrência.
 */
export function expandOccurrences<
  T extends RecurringEventLike & Record<string, unknown>,
>(event: T, from: Date, to: Date): T[] {
  const intersects = (start: Date, end: Date): boolean =>
    start.getTime() <= to.getTime() && end.getTime() >= from.getTime();

  const parsed = parseRecurrenceRule(event.recurrenceRule);
  if (!parsed) {
    return intersects(event.startAt, event.endAt) ? [event] : [];
  }

  const durationMs = event.endAt.getTime() - event.startAt.getTime();
  const seriesEnd = effectiveUntil(parsed, event.recurrenceUntil);

  // Dias-alvo (WEEKLY), em UTC. Ausente → o dia (UTC) do mestre.
  const targetDays =
    parsed.freq === 'WEEKLY'
      ? parsed.byDay.length > 0
        ? new Set(parsed.byDay)
        : new Set([event.startAt.getUTCDay()])
      : null;

  const out: T[] = [];
  const stepDays = parsed.freq === 'DAILY' ? parsed.interval : 1;

  // Cursor avança em dias (UTC) a partir do start do mestre; para WEEKLY o INTERVAL
  // filtra por nº de semanas decorridas desde o start.
  let cursor = new Date(event.startAt.getTime());
  let guard = 0;

  while (guard < MAX_OCCURRENCES) {
    guard += 1;

    // Para de iterar se passou do fim da janela E do limite da série.
    if (cursor.getTime() > to.getTime()) break;
    if (seriesEnd && cursor.getTime() > seriesEnd.getTime()) break;

    let emit = cursor.getTime() >= event.startAt.getTime();
    if (emit && parsed.freq === 'WEEKLY' && targetDays) {
      if (!targetDays.has(cursor.getUTCDay())) {
        emit = false;
      } else if (parsed.interval > 1) {
        // Semanas decorridas desde a semana do start (ancoradas no domingo UTC).
        const weeksElapsed = Math.floor(
          (startOfWeekUtc(cursor).getTime() - startOfWeekUtc(event.startAt).getTime()) /
            (7 * DAY_MS),
        );
        if (weeksElapsed % parsed.interval !== 0) emit = false;
      }
    }

    if (emit) {
      const occStart = new Date(cursor.getTime());
      const occEnd = new Date(occStart.getTime() + durationMs);
      if ((!seriesEnd || occStart.getTime() <= seriesEnd.getTime()) && intersects(occStart, occEnd)) {
        out.push({
          ...event,
          id: occurrenceId(event.id, occStart),
          startAt: occStart,
          endAt: occEnd,
          recurrenceParentId: event.id,
        });
      }
    }

    cursor = new Date(cursor.getTime() + stepDays * DAY_MS);
  }

  return out;
}

/** Domingo 00:00 UTC da semana que contém `d` — âncora p/ INTERVAL semanal. */
function startOfWeekUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x;
}
