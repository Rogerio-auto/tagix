/**
 * Quanto tempo o envio leva — estimativa local da etapa **Quando enviar** (F58-S10).
 *
 * Função PURA e determinística (`startAt` sempre por parâmetro): roda a cada
 * tecla, sem rede, e o teste fixa o resultado sem depender da data.
 *
 * ## Promete o que o worker faz
 *
 * Espelha as regras reais do worker de campanhas (`apps/workers/src/campaigns/`,
 * F58-S11), e não um `contatos / ritmo` que mente por dias:
 *
 * - **ritmo**: a vazão média é exatamente o ritmo por minuto (compasso GCRA em
 *   `rate.ts`); qualidade em alerta (`YELLOW`) corta pela metade, com piso de 1 —
 *   o chamador já passa o ritmo efetivo (`effectiveRate`);
 * - **horários permitidos**: só envia dentro das faixas `[início, fim)` do dia
 *   local, no fuso da campanha (`windows.ts`);
 * - **limite por dia**: zera na virada do dia no fuso da campanha
 *   (`steps/state.ts → evaluateDailyQuota`); o primeiro dia começa cheio;
 * - **prazo final**: nada sai a partir dele; quem não recebeu fica de fora.
 *
 * Diferente da estimativa do servidor (F58-S06), que conta 1440 minutos por dia,
 * aqui cada faixa vira instante real pelo fuso — no dia em que o relógio adianta
 * ou atrasa, a faixa tem 1 h a menos ou a mais, como no worker.
 */
import {
  addCalendarDays,
  calendarDateIn,
  localDateTime,
  resolveWallTime,
  weekdayOf,
  type CalendarDate,
} from './timezone';

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 1_440;
/** Além disso a configuração é inviável — a tela pede para mudar, não estima. */
export const HORIZON_DAYS = 366;

export interface WindowSlot {
  /** 0 = domingo … 6 = sábado. */
  readonly day: number;
  /** HH:MM. */
  readonly start: string;
  /** HH:MM. */
  readonly end: string;
}

export interface ScheduleInput {
  /** Mensagens a enviar nesta onda (contatos × 1 na primeira mensagem). */
  readonly messages: number;
  /** Ritmo EFETIVO por minuto (já com o corte de qualidade). */
  readonly ratePerMinute: number;
  /** Teto diário efetivo (o menor entre o seu limite e a capacidade do número). */
  readonly dailyCap: number | null;
  /** `null` = qualquer horário. */
  readonly windows: readonly WindowSlot[] | null;
  readonly timeZone: string;
  readonly startAt: Date;
  /** Prazo final: nenhum envio a partir daqui. */
  readonly deadline: Date | null;
}

/** O que mais segura o envio no primeiro dia — o que a tela explica. */
export type ScheduleLimit = 'pace' | 'hours' | 'daily_cap';

export type ScheduleEstimate =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ok';
      /** Instante aproximado do último envio. */
      readonly finishesAt: Date;
      /** Primeiro instante em que algo sai (pode esperar o horário abrir). */
      readonly firstSendAt: Date;
      /** Dias de calendário com envio (1 = termina no dia em que começa). */
      readonly sendingDays: number;
      readonly limitedBy: ScheduleLimit;
      /** Quantos recebem antes do prazo final (= `messages` sem prazo ou se couber). */
      readonly reached: number;
      /** `true` quando o prazo final corta parte do público. */
      readonly cutByDeadline: boolean;
    }
  /** Nem em um ano caberia (ex.: horários vazios na prática). */
  | { readonly kind: 'unfeasible'; readonly reached: number };

interface Interval {
  readonly start: number;
  readonly end: number;
}

function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= MINUTES_PER_DAY ? minutes : null;
}

/** Faixas de um dia da semana, válidas, ordenadas e fundidas (o worker aceita sobreposição). */
export function intervalsForWeekday(
  windows: readonly WindowSlot[] | null,
  weekday: number,
): readonly Interval[] {
  if (windows === null) return [{ start: 0, end: MINUTES_PER_DAY }];
  const sorted = windows
    .filter((w) => w.day === weekday)
    .map((w) => ({ start: toMinutes(w.start), end: toMinutes(w.end) }))
    .filter((i): i is Interval => i.start !== null && i.end !== null && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** Instante real de um minuto do dia local (1440 = meia-noite seguinte). */
function instantOf(date: CalendarDate, minute: number, timeZone: string): number {
  if (minute >= MINUTES_PER_DAY) {
    return resolveWallTime(addCalendarDays(date, 1), 0, timeZone).instant.getTime();
  }
  return resolveWallTime(date, minute, timeZone).instant.getTime();
}

/**
 * Caminha dia a dia pelo calendário do fuso, consumindo ritmo e teto, até
 * enviar tudo, bater o prazo ou passar do horizonte.
 */
export function estimateSchedule(input: ScheduleInput): ScheduleEstimate {
  const total = Math.max(0, Math.floor(input.messages));
  if (total === 0) return { kind: 'empty' };

  const rate = Math.max(1, Math.floor(input.ratePerMinute));
  const perMessageMs = MINUTE_MS / rate;
  const cap =
    input.dailyCap === null ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(input.dailyCap));
  const startMs = input.startAt.getTime();
  const deadlineMs = input.deadline ? input.deadline.getTime() : Number.POSITIVE_INFINITY;
  const firstDate = calendarDateIn(input.startAt, input.timeZone);
  const fullDay = input.windows === null;

  let remaining = total;
  let sent = 0;
  let firstSendAt: number | null = null;
  let firstSendDay = -1;
  let lastSendAt = startMs;
  let lastSendDay = -1;
  let limitedBy: ScheduleLimit | null = null;

  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const date = addCalendarDays(firstDate, offset);
    const intervals = intervalsForWeekday(input.windows, weekdayOf(date));
    if (intervals.length === 0) continue;

    // Faixas do dia como instantes reais, recortadas pelo início e pelo prazo.
    const spans: Array<{ from: number; to: number }> = [];
    for (const interval of intervals) {
      const from = Math.max(instantOf(date, interval.start, input.timeZone), startMs);
      const to = Math.min(instantOf(date, interval.end, input.timeZone), deadlineMs);
      if (to > from) spans.push({ from, to });
    }
    if (spans.length === 0) {
      if (instantOf(date, 0, input.timeZone) >= deadlineMs) break;
      continue;
    }

    const minutesOpen = spans.reduce((acc, s) => acc + (s.to - s.from) / MINUTE_MS, 0);
    const paceCapacity = Math.floor(minutesOpen * rate);
    if (limitedBy === null && paceCapacity > 0) {
      limitedBy =
        cap < paceCapacity
          ? 'daily_cap'
          : !fullDay && minutesOpen < MINUTES_PER_DAY - 1
            ? 'hours'
            : 'pace';
    }

    let dayBudget = Math.min(cap, remaining);
    for (const span of spans) {
      if (dayBudget <= 0) break;
      // A primeira mensagem da faixa sai no início dela; a k-ésima, (k−1) intervalos
      // depois — cabe enquanto esse instante ainda está antes do fim da faixa.
      const fits = Math.ceil((span.to - span.from) / perMessageMs);
      const count = Math.min(dayBudget, fits);
      if (count <= 0) continue;
      if (firstSendAt === null) {
        firstSendAt = span.from;
        firstSendDay = offset;
      }
      sent += count;
      remaining -= count;
      dayBudget -= count;
      lastSendAt = span.from + (count - 1) * perMessageMs;
      lastSendDay = offset;
      if (remaining === 0) {
        return {
          kind: 'ok',
          finishesAt: roundUpToMinute(lastSendAt),
          firstSendAt: new Date(firstSendAt),
          sendingDays: offset - firstSendDay + 1,
          limitedBy: limitedBy ?? 'pace',
          reached: sent,
          cutByDeadline: false,
        };
      }
    }
    if (instantOf(date, MINUTES_PER_DAY, input.timeZone) >= deadlineMs) break;
  }

  if (Number.isFinite(deadlineMs) && sent < total) {
    if (firstSendAt === null) return { kind: 'unfeasible', reached: 0 };
    return {
      kind: 'ok',
      finishesAt: roundUpToMinute(lastSendAt),
      firstSendAt: new Date(firstSendAt),
      sendingDays: lastSendDay - firstSendDay + 1,
      limitedBy: limitedBy ?? 'pace',
      reached: sent,
      cutByDeadline: true,
    };
  }
  return { kind: 'unfeasible', reached: sent };
}

function roundUpToMinute(ms: number): Date {
  return new Date(Math.ceil(ms / MINUTE_MS) * MINUTE_MS);
}

/** Minutos abertos por semana (para avisar faixa curta demais). */
export function weeklyOpenMinutes(windows: readonly WindowSlot[] | null): number {
  let total = 0;
  for (let day = 0; day < 7; day += 1) {
    for (const i of intervalsForWeekday(windows, day)) total += i.end - i.start;
  }
  return total;
}

/** Minuto do dia local agora (útil para "o horário de hoje já fechou"). */
export function minuteOfDayIn(instant: Date, timeZone: string): number {
  const wall = localDateTime(instant, timeZone);
  return wall.hour * 60 + wall.minute;
}
