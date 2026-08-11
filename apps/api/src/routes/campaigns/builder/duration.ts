/**
 * Duração aproximada de um disparo (CAMPAIGNS.md §4 "Quando enviar", §6, §7).
 *
 * A etapa Quando enviar promete "quanto tempo isso vai levar" — e a promessa só
 * é honesta se o cálculo respeitar as três restrições reais: ritmo por minuto,
 * teto diário e horários permitidos. Um cálculo `mensagens / ritmo` ignora as
 * duas últimas e mente por dias inteiros quando há janela de envio.
 *
 * Função PURA e determinística (relógio injetado): a UI recalcula a cada
 * mudança sem tocar no banco, e o teste fixa o resultado sem depender da data.
 *
 * Aproximação assumida: um dia local vale 1440 minutos. Nos dois dias de virada
 * de horário de verão o fim estimado desloca em até 1h — irrelevante para um
 * número apresentado como aproximado, e o worker (F58-S11) é quem tem a palavra
 * final sobre o instante de cada envio.
 */

export interface SendWindowSlot {
  readonly day: number;
  readonly start: string;
  readonly end: string;
}

export interface SendWindowsConfig {
  readonly enabled: boolean;
  readonly timezone?: string | undefined;
  readonly windows?: readonly SendWindowSlot[] | undefined;
}

export interface ScheduleInput {
  readonly messages: number;
  readonly ratePerMinute: number;
  readonly dailyLimit: number;
  readonly sendWindows: SendWindowsConfig;
  readonly timezone: string;
  readonly startAt: Date;
}

export type ScheduleLimit = 'none' | 'rate' | 'daily_limit' | 'send_windows';

export interface ScheduleEstimate {
  /** Minutos de relógio entre o início e o último envio. */
  readonly approximateMinutes: number;
  /** Dias de calendário ocupados (1 = termina no mesmo dia em que começa). */
  readonly approximateDays: number;
  readonly finishesAt: string | null;
  readonly limitedBy: ScheduleLimit;
  /** `true` quando nem em um ano o público caberia — configuração inviável. */
  readonly exceedsHorizon: boolean;
}

const MINUTES_PER_DAY = 1_440;
const MAX_HORIZON_DAYS = 365;

interface Interval {
  readonly start: number;
  readonly end: number;
}

interface LocalMoment {
  readonly weekday: number;
  readonly minuteOfDay: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Dia da semana + minuto do dia NO FUSO da campanha. As janelas são horários
 * locais; ler o instante em UTC deslocaria a conta em até um dia inteiro.
 */
export function localMoment(date: Date, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = WEEKDAYS[read('weekday')] ?? date.getUTCDay();
  // `hour12:false` devolve "24" para meia-noite em alguns runtimes — normaliza.
  const hour = Number(read('hour')) % 24;
  const minute = Number(read('minute'));
  return {
    weekday,
    minuteOfDay: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** Intervalos de um dia da semana, normalizados, ordenados e sem sobreposição. */
function intervalsFor(config: SendWindowsConfig, weekday: number): readonly Interval[] {
  const windows = config.windows ?? [];
  if (!config.enabled || windows.length === 0) return [{ start: 0, end: MINUTES_PER_DAY }];
  const sorted = windows
    .filter((window) => window.day === weekday)
    .map((window) => ({ start: toMinutes(window.start), end: toMinutes(window.end) }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
      continue;
    }
    merged.push(interval);
  }
  return merged;
}

function clipFrom(intervals: readonly Interval[], fromMinute: number): readonly Interval[] {
  return intervals
    .map((interval) => ({ start: Math.max(interval.start, fromMinute), end: interval.end }))
    .filter((interval) => interval.end > interval.start);
}

function availableMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((total, interval) => total + (interval.end - interval.start), 0);
}

/** Minuto do dia em que o N-ésimo minuto útil termina, caminhando pelos intervalos. */
function minuteAfterConsuming(intervals: readonly Interval[], minutesNeeded: number): number {
  let remaining = minutesNeeded;
  for (const interval of intervals) {
    const length = interval.end - interval.start;
    if (remaining <= length) return interval.start + remaining;
    remaining -= length;
  }
  return intervals.at(-1)?.end ?? 0;
}

export function estimateSchedule(input: ScheduleInput): ScheduleEstimate {
  const rate = Math.max(1, Math.floor(input.ratePerMinute));
  const dailyLimit = Math.max(1, Math.floor(input.dailyLimit));
  const timezone = input.sendWindows.timezone ?? input.timezone;

  if (input.messages <= 0) {
    return {
      approximateMinutes: 0,
      approximateDays: 0,
      finishesAt: input.startAt.toISOString(),
      limitedBy: 'none',
      exceedsHorizon: false,
    };
  }

  const start = localMoment(input.startAt, timezone);
  let remaining = input.messages;
  let limitedBy: ScheduleLimit = 'rate';
  let firstProductiveDaySeen = false;

  for (let dayOffset = 0; dayOffset < MAX_HORIZON_DAYS; dayOffset += 1) {
    const weekday = (start.weekday + dayOffset) % 7;
    const dayIntervals =
      dayOffset === 0
        ? clipFrom(intervalsFor(input.sendWindows, weekday), start.minuteOfDay)
        : intervalsFor(input.sendWindows, weekday);
    const minutes = availableMinutes(dayIntervals);
    if (minutes === 0) continue;

    const rateCapacity = minutes * rate;
    const dayCapacity = Math.min(dailyLimit, rateCapacity);
    if (!firstProductiveDaySeen) {
      firstProductiveDaySeen = true;
      // O gargalo é lido no primeiro dia útil: é o que a interface precisa
      // explicar ("o teto diário divide o envio", "a janela é curta demais").
      limitedBy =
        dailyLimit < rateCapacity
          ? 'daily_limit'
          : input.sendWindows.enabled && minutes < MINUTES_PER_DAY
            ? 'send_windows'
            : 'rate';
    }

    if (remaining > dayCapacity) {
      remaining -= dayCapacity;
      continue;
    }

    const minutesNeeded = Math.max(1, Math.ceil(remaining / rate));
    const endMinuteOfDay = minuteAfterConsuming(dayIntervals, minutesNeeded);
    const elapsed = dayOffset * MINUTES_PER_DAY + endMinuteOfDay - start.minuteOfDay;
    return {
      approximateMinutes: Math.max(1, elapsed),
      approximateDays: dayOffset + 1,
      finishesAt: new Date(input.startAt.getTime() + Math.max(1, elapsed) * 60_000).toISOString(),
      limitedBy,
      exceedsHorizon: false,
    };
  }

  return {
    approximateMinutes: MAX_HORIZON_DAYS * MINUTES_PER_DAY,
    approximateDays: MAX_HORIZON_DAYS,
    finishesAt: null,
    limitedBy: firstProductiveDaySeen ? limitedBy : 'send_windows',
    exceedsHorizon: true,
  };
}
