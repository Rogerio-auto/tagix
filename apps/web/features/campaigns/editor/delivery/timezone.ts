/**
 * Fuso horário e horário de parede para a etapa **Quando enviar** (F58-S10).
 *
 * Módulo PURO (só `Intl`), testado isolado. Resolve o problema que toda tela de
 * agendamento erra em silêncio: a pessoa escolhe "10/11 às 02:30" num fuso que
 * NÃO é o do navegador, e esse horário pode
 *
 * - **não existir** (o relógio adianta de 02:00 para 03:00 no início do horário
 *   de verão) — `gap`; ou
 * - **existir duas vezes** (o relógio volta de 02:00 para 01:00 no fim) —
 *   `ambiguous`.
 *
 * `new Date('2026-11-01T01:30')` usaria o fuso do NAVEGADOR e erraria por horas.
 * Aqui o horário é sempre lido no fuso da campanha, com a mesma regra do
 * Temporal (`disambiguation: 'compatible'`): no buraco, avança pelo tamanho do
 * salto; na repetição, fica com a primeira ocorrência. A tela avisa nos dois.
 */

import { getMarketPack } from '@hm/shared';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const MARKET = getMarketPack('BR');
/** Idioma da interface — do market pack, não do componente. */
export const UI_LOCALE = MARKET.defaultLocale;
/** Fuso padrão de uma campanha nova quando o workspace não informa outro. */
export const MARKET_DEFAULT_TIMEZONE = MARKET.defaultTimezone;
/**
 * Locale de LEITURA (não de exibição): `formatToParts` em inglês devolve dia da
 * semana e números em formato estável (`Sun`, `09`) para o parser abaixo.
 */
const PARSE_LOCALE = 'en-US';

/* ── Validação de fuso ───────────────────────────────────────────────────── */

const validity = new Map<string, boolean>();

/** `true` se o runtime reconhece o identificador IANA (ex.: `America/Sao_Paulo`). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim().length === 0) return false;
  const cached = validity.get(timeZone);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat(PARSE_LOCALE, { timeZone });
    ok = true;
  } catch {
    ok = false;
  }
  validity.set(timeZone, ok);
  return ok;
}

/** Fuso do navegador, ou `fallback` quando o runtime não informa um válido. */
export function browserTimeZone(fallback: string): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : fallback;
  } catch {
    return fallback;
  }
}

/* ── Partes locais de um instante ────────────────────────────────────────── */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(PARSE_LOCALE, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatters.set(timeZone, fmt);
  }
  return fmt;
}

export interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Data e hora de parede de `instant` no fuso dado. */
export function localDateTime(instant: Date | number, timeZone: string): LocalDateTime {
  const parts = partsFormatter(timeZone).formatToParts(
    typeof instant === 'number' ? new Date(instant) : instant,
  );
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((p) => p.type === type)?.value ?? '0';
    return Number(raw);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Alguns runtimes devolvem "24" à meia-noite mesmo com h23.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

const OFFSET_BUCKET_MS = 15 * 60_000;
const OFFSET_CACHE_MAX = 20_000;
const offsetCache = new Map<string, number>();

/** Deslocamento do fuso (ms) em `instant`: hora de parede − UTC. */
export function offsetMs(instant: number, timeZone: string): number {
  // Transições de fuso acontecem em instantes múltiplos de 15 min (inclusive nos
  // fusos de :30/:45): dentro de um bloco de 15 min o deslocamento é constante.
  // O cache torna barata a estimativa, que recalcula a cada tecla e por ritmo.
  const bucket = Math.floor(instant / OFFSET_BUCKET_MS);
  const key = `${timeZone}|${bucket}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const probe = bucket * OFFSET_BUCKET_MS;
  const wall = localDateTime(probe, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offset = asUtc - probe;
  if (offsetCache.size >= OFFSET_CACHE_MAX) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/* ── Datas de calendário (YYYY-MM-DD) ────────────────────────────────────── */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_RE = /^(\d{2}):(\d{2})$/u;

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Lê `YYYY-MM-DD` rejeitando datas que o calendário não tem (31/02). */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Lê `HH:MM` (00:00–23:59) como minuto do dia. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_RE.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatCalendarDate(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${mm}-${dd}`;
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const safe = Math.max(0, Math.min(1439, Math.floor(minuteOfDay)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Soma dias de calendário (sem fuso: aritmética pura de data). */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

/** 0 = domingo … 6 = sábado (mesma convenção das janelas no servidor). */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Data de calendário de `instant` no fuso. */
export function calendarDateIn(instant: Date | number, timeZone: string): CalendarDate {
  const wall = localDateTime(instant, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

/* ── Horário de parede → instante ────────────────────────────────────────── */

export type WallTimeResolution =
  | { readonly kind: 'exact'; readonly instant: Date }
  /** O horário não existe nesse dia (relógio adiantou). `instant` já foi empurrado. */
  | { readonly kind: 'gap'; readonly instant: Date; readonly shiftMinutes: number }
  /** O horário existe duas vezes (relógio voltou). `instant` = primeira ocorrência. */
  | { readonly kind: 'ambiguous'; readonly instant: Date; readonly laterInstant: Date };

/**
 * Converte data + minuto do dia, lidos NO FUSO, num instante absoluto.
 * `minuteOfDay` pode ser 1440 (meia-noite do dia seguinte) para fechar janelas.
 */
export function resolveWallTime(
  date: CalendarDate,
  minuteOfDay: number,
  timeZone: string,
): WallTimeResolution {
  const local = Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * MINUTE_MS;
  // Deslocamentos um dia antes e um dia depois: as duas regras possíveis em
  // volta de qualquer transição (nenhum fuso real muda duas vezes em 48 h).
  const before = offsetMs(local - DAY_MS, timeZone);
  const after = offsetMs(local + DAY_MS, timeZone);
  const candidates = [...new Set([before, after])]
    .map((offset) => local - offset)
    .filter((instant) => offsetMs(instant, timeZone) === local - instant)
    .sort((a, b) => a - b);

  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  if (first === undefined || last === undefined) {
    // Buraco: mantém o deslocamento de ANTES — o ponteiro anda o tamanho do salto.
    return {
      kind: 'gap',
      instant: new Date(local - before),
      shiftMinutes: Math.round(Math.abs(after - before) / MINUTE_MS),
    };
  }
  if (first !== last) {
    return { kind: 'ambiguous', instant: new Date(first), laterInstant: new Date(last) };
  }
  return { kind: 'exact', instant: new Date(first) };
}

/* ── Rótulos legíveis ────────────────────────────────────────────────────── */

/** `GMT-3`, `GMT+1`, `GMT` — o deslocamento em vigor naquele instante. */
export function offsetLabel(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat(PARSE_LOCALE, {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(instant);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  } catch {
    const minutes = Math.round(offsetMs(instant.getTime(), timeZone) / MINUTE_MS);
    if (minutes === 0) return 'GMT';
    const sign = minutes > 0 ? '+' : '-';
    const abs = Math.abs(minutes);
    const tail = abs % 60 === 0 ? '' : `:${String(abs % 60).padStart(2, '0')}`;
    return `GMT${sign}${Math.floor(abs / 60)}${tail}`;
  }
}

/** Nome do fuso em português ("Horário de Brasília"), ou o próprio identificador. */
export function timeZoneName(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat(UI_LOCALE, {
      timeZone,
      timeZoneName: 'longGeneric',
    }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^GMT/u.test(name)) return name;
  } catch {
    // cai no identificador abaixo
  }
  return timeZone.replace(/_/gu, ' ');
}

/** "sex., 10 de out. às 09:00" no fuso dado. */
export function formatMoment(instant: Date, timeZone: string, now?: Date): string {
  const day = new Intl.DateTimeFormat(UI_LOCALE, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(instant);
  const time = new Intl.DateTimeFormat(UI_LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  if (now) {
    const today = calendarDateIn(now, timeZone);
    const target = calendarDateIn(instant, timeZone);
    const same = (a: CalendarDate, b: CalendarDate): boolean =>
      a.year === b.year && a.month === b.month && a.day === b.day;
    if (same(today, target)) return `hoje às ${time}`;
    if (same(addCalendarDays(today, 1), target)) return `amanhã às ${time}`;
  }
  return `${day} às ${time}`;
}

/** "09:00" no fuso dado. */
export function formatClock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(UI_LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/* ── Catálogo de fusos para o seletor ────────────────────────────────────── */

export interface TimeZoneOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Fusos do Brasil com o nome que as pessoas usam, não a cidade-sede da IANA.
 * Catálogo do seletor (dado, não escolha de fuso em componente).
 */
/* eslint-disable no-restricted-syntax -- catálogo de fusos oferecidos no seletor */
export const BRAZIL_TIME_ZONES: readonly TimeZoneOption[] = [
  { id: 'America/Sao_Paulo', label: 'Brasília — maior parte do Brasil' },
  { id: 'America/Manaus', label: 'Amazonas, Mato Grosso, Rondônia, Roraima' },
  { id: 'America/Rio_Branco', label: 'Acre' },
  { id: 'America/Noronha', label: 'Fernando de Noronha' },
];
/* eslint-enable no-restricted-syntax */

/** Todos os fusos IANA do runtime (vazio se o runtime não listar). */
export function allTimeZones(): readonly string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}
