/**
 * Regra da etapa **Quando enviar** do criador de campanha (F58-S10).
 *
 * Módulo PURO — sem React, sem rede — testado isolado. A tela só apresenta o
 * que sai daqui.
 *
 * ## A tradução que o usuário nunca vê
 *
 * A pessoa decide em frases: "Agendar para amanhã às 9h", "Horário comercial",
 * "Ritmo recomendado". Quem converte isso no contrato da API
 * (`startAt`/`endAt`/`timezone`/`sendWindows`/`rateLimitPerMinute`/`dailyLimit`
 * do `PATCH /api/campaigns/:id`) é `toDeliveryPayload`. As palavras "send
 * window", "rate" e "tier" não aparecem na interface (CAMPAIGNS.md §2).
 *
 * ## Promete o que o backend faz (F58-S11)
 *
 * - `startAt` futuro → a campanha fica `scheduled` e o worker a inicia na hora;
 *   `null` → começa quando for iniciada na Revisão.
 * - `endAt` precisa ser depois do início (a API recusa `endAt <= startAt`); a
 *   partir dele nada sai e quem não recebeu fica de fora.
 * - Ritmo: 1–600 por minuto (Zod da API). Qualidade em alerta corta pela metade
 *   (`effectiveRatePerMinute` do worker); qualidade crítica pausa.
 * - Horários: faixas `[início, fim)` no mesmo dia (sem atravessar a meia-noite),
 *   no fuso da campanha; o limite por dia também vira no fuso da campanha — por
 *   isso o payload grava o MESMO fuso nos dois lugares.
 */
import {
  BRAZIL_TIME_ZONES,
  MARKET_DEFAULT_TIMEZONE,
  UI_LOCALE,
  addCalendarDays,
  calendarDateIn,
  formatCalendarDate,
  formatTimeOfDay,
  isValidTimeZone,
  localDateTime,
  parseCalendarDate,
  parseTimeOfDay,
  resolveWallTime,
  weekdayOf,
  type WallTimeResolution,
} from './timezone';
import { estimateSchedule, type ScheduleEstimate, type WindowSlot } from './schedule';

/* ── Limites do contrato (espelham o Zod de `crud.ts`) ───────────────────── */

export const RATE_MIN = 1;
export const RATE_MAX = 600;
/** Acima disso o preflight avisa: ritmo agressivo para o WhatsApp. */
export const RATE_AGGRESSIVE_ABOVE = 60;
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 1_000_000;
/** Limite da API para o número de faixas. */
export const MAX_WINDOWS = 60;
/** Faixas por dia no editor — mais que isso vira grade ilegível. */
export const MAX_WINDOWS_PER_DAY = 4;
export const DEFAULT_TIMEZONE = MARKET_DEFAULT_TIMEZONE;
export const DEFAULT_DAILY_LIMIT = 1_000;

/* ── Valor da etapa ──────────────────────────────────────────────────────── */

export type StartMode = 'now' | 'scheduled';
export type PaceId = 'careful' | 'recommended' | 'fast' | 'custom';
export type HoursPresetId = 'business' | 'business_saturday' | 'everyday' | 'anytime' | 'custom';
export type ChannelQuality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type CampaignMode = 'single' | 'sequence';

export interface WindowDraft {
  /** Chave estável para a lista do editor (não vai para a API). */
  readonly key: string;
  readonly day: number;
  readonly start: string;
  readonly end: string;
}

export interface DeliveryStepValue {
  readonly start: StartMode;
  /** `YYYY-MM-DD` no fuso da campanha. */
  readonly scheduleDate: string;
  /** `HH:MM` no fuso da campanha. */
  readonly scheduleTime: string;
  readonly timezone: string;
  /** `false` = qualquer horário. */
  readonly hoursEnabled: boolean;
  readonly windows: readonly WindowDraft[];
  readonly pace: PaceId;
  /** Usado só quando `pace = 'custom'`. */
  readonly customRate: number;
  readonly dailyLimitEnabled: boolean;
  readonly dailyLimit: number;
  readonly deadlineEnabled: boolean;
  readonly deadlineDate: string;
  readonly deadlineTime: string;
}

/** Contexto que muda a estimativa sem ser escolha da etapa. */
export interface DeliveryContext {
  /** Contatos que vão receber. `null` = ainda não se sabe. */
  readonly audience: number | null;
  readonly quality: ChannelQuality;
  /** Quantas pessoas o número pode abordar por dia (capacidade do WhatsApp). `null` = desconhecida. */
  readonly providerDailyLimit: number | null;
  readonly mode: CampaignMode;
}

/* ── Ritmo ───────────────────────────────────────────────────────────────── */

export interface PaceOption {
  readonly id: Exclude<PaceId, 'custom'>;
  readonly title: string;
  readonly hint: string;
  readonly ratePerMinute: number;
}

/** Recomendado = padrão da API (30/min). Rápido = o teto antes do aviso de ritmo agressivo. */
export const PACE_OPTIONS: readonly PaceOption[] = [
  {
    id: 'careful',
    title: 'Cuidadoso',
    hint: 'Para número novo ou que acabou de voltar de um alerta.',
    ratePerMinute: 20,
  },
  {
    id: 'recommended',
    title: 'Recomendado',
    hint: 'Equilíbrio entre velocidade e a reputação do número.',
    ratePerMinute: 30,
  },
  {
    id: 'fast',
    title: 'Rápido',
    hint: 'Para número com histórico bom e público que espera a mensagem.',
    ratePerMinute: 60,
  },
];

export function rateForPace(value: Pick<DeliveryStepValue, 'pace' | 'customRate'>): number {
  if (value.pace === 'custom') return Math.round(value.customRate);
  return PACE_OPTIONS.find((p) => p.id === value.pace)?.ratePerMinute ?? 30;
}

export function paceForRate(rate: number): { pace: PaceId; customRate: number } {
  const preset = PACE_OPTIONS.find((p) => p.ratePerMinute === rate);
  return preset ? { pace: preset.id, customRate: rate } : { pace: 'custom', customRate: rate };
}

/**
 * Ritmo que o worker aplica de fato (`effectiveRatePerMinute`): alerta corta pela
 * metade com piso de 1; crítico = 0 (a campanha pausa).
 */
export function effectiveRate(rate: number, quality: ChannelQuality): number {
  if (quality === 'RED') return 0;
  const base = Math.max(RATE_MIN, Math.floor(rate));
  return quality === 'YELLOW' ? Math.max(1, Math.floor(base * 0.5)) : base;
}

/* ── Horários ────────────────────────────────────────────────────────────── */

export const WEEKDAYS: ReadonlyArray<{
  readonly day: number;
  readonly short: string;
  readonly long: string;
}> = [
  { day: 1, short: 'Seg', long: 'Segunda' },
  { day: 2, short: 'Ter', long: 'Terça' },
  { day: 3, short: 'Qua', long: 'Quarta' },
  { day: 4, short: 'Qui', long: 'Quinta' },
  { day: 5, short: 'Sex', long: 'Sexta' },
  { day: 6, short: 'Sáb', long: 'Sábado' },
  { day: 0, short: 'Dom', long: 'Domingo' },
];

export function weekdayLong(day: number): string {
  return WEEKDAYS.find((w) => w.day === day)?.long ?? 'Dia';
}

interface PresetSlot {
  readonly day: number;
  readonly start: string;
  readonly end: string;
}

export interface HoursPreset {
  readonly id: Exclude<HoursPresetId, 'custom'>;
  readonly title: string;
  readonly detail: string;
  /** `null` = qualquer horário. */
  readonly slots: readonly PresetSlot[] | null;
}

const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5] as const;

export const HOURS_PRESETS: readonly HoursPreset[] = [
  {
    id: 'business',
    title: 'Horário comercial',
    detail: 'Segunda a sexta, das 9h às 18h',
    slots: WEEKDAYS_MON_FRI.map((day) => ({ day, start: '09:00', end: '18:00' })),
  },
  {
    id: 'business_saturday',
    title: 'Comercial e sábado de manhã',
    detail: 'Segunda a sexta, 9h às 18h · sábado, 9h às 13h',
    slots: [
      ...WEEKDAYS_MON_FRI.map((day) => ({ day, start: '09:00', end: '18:00' })),
      { day: 6, start: '09:00', end: '13:00' },
    ],
  },
  {
    id: 'everyday',
    title: 'Todos os dias',
    detail: 'Das 8h às 20h, inclusive fim de semana',
    slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '08:00', end: '20:00' })),
  },
  {
    id: 'anytime',
    title: 'Qualquer horário',
    detail: 'Inclusive de madrugada',
    slots: null,
  },
];

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `w${keySeq}`;
}

function toDrafts(slots: readonly PresetSlot[]): WindowDraft[] {
  return slots.map((s) => ({ key: nextKey(), day: s.day, start: s.start, end: s.end }));
}

function slotSignature(slots: readonly { day: number; start: string; end: string }[]): string {
  return slots
    .map((s) => `${s.day}|${s.start}|${s.end}`)
    .sort()
    .join(',');
}

/** Qual preset a configuração atual é — ou `custom`. */
export function detectHoursPreset(
  value: Pick<DeliveryStepValue, 'hoursEnabled' | 'windows'>,
): HoursPresetId {
  if (!value.hoursEnabled) return 'anytime';
  const signature = slotSignature(value.windows);
  const match = HOURS_PRESETS.find((p) => p.slots !== null && slotSignature(p.slots) === signature);
  return match ? match.id : 'custom';
}

export function applyHoursPreset(
  value: DeliveryStepValue,
  presetId: Exclude<HoursPresetId, 'custom'>,
): DeliveryStepValue {
  const preset = HOURS_PRESETS.find((p) => p.id === presetId);
  if (!preset) return value;
  if (preset.slots === null) return { ...value, hoursEnabled: false };
  return { ...value, hoursEnabled: true, windows: toDrafts(preset.slots) };
}

/** Abre o editor semanal a partir do que já está valendo (nunca de uma grade vazia). */
export function startCustomHours(value: DeliveryStepValue): DeliveryStepValue {
  if (value.hoursEnabled && value.windows.length > 0) return value;
  const fallback = HOURS_PRESETS[0]?.slots ?? [];
  return { ...value, hoursEnabled: true, windows: toDrafts(fallback) };
}

export function windowsForDay(
  value: Pick<DeliveryStepValue, 'windows'>,
  day: number,
): readonly WindowDraft[] {
  return value.windows
    .filter((w) => w.day === day)
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Liga/desliga um dia inteiro. Ligar começa com 9h–18h. */
export function toggleDay(value: DeliveryStepValue, day: number, on: boolean): DeliveryStepValue {
  const rest = value.windows.filter((w) => w.day !== day);
  if (!on) return { ...value, hoursEnabled: true, windows: rest };
  if (value.windows.some((w) => w.day === day)) return value;
  return {
    ...value,
    hoursEnabled: true,
    windows: [...rest, { key: nextKey(), day, start: '09:00', end: '18:00' }],
  };
}

/** Nova faixa no dia: começa onde a última termina (sem sobrepor), se couber. */
export function addWindow(value: DeliveryStepValue, day: number): DeliveryStepValue {
  const sameDay = windowsForDay(value, day);
  if (sameDay.length >= MAX_WINDOWS_PER_DAY || value.windows.length >= MAX_WINDOWS) return value;
  const last = sameDay[sameDay.length - 1];
  const lastEnd = last ? (parseTimeOfDay(last.end) ?? 18 * 60) : 9 * 60 - 60;
  const start = Math.min(lastEnd + 60, 22 * 60);
  const end = Math.min(start + 120, 23 * 60 + 59);
  return {
    ...value,
    hoursEnabled: true,
    windows: [
      ...value.windows,
      { key: nextKey(), day, start: formatTimeOfDay(start), end: formatTimeOfDay(end) },
    ],
  };
}

export function updateWindow(
  value: DeliveryStepValue,
  key: string,
  patch: Partial<Pick<WindowDraft, 'start' | 'end'>>,
): DeliveryStepValue {
  return {
    ...value,
    windows: value.windows.map((w) => (w.key === key ? { ...w, ...patch } : w)),
  };
}

export function removeWindow(value: DeliveryStepValue, key: string): DeliveryStepValue {
  return { ...value, windows: value.windows.filter((w) => w.key !== key) };
}

/** Repete as faixas de `fromDay` em todos os dias que já têm horário. */
export function copyDayToActiveDays(value: DeliveryStepValue, fromDay: number): DeliveryStepValue {
  const source = windowsForDay(value, fromDay);
  if (source.length === 0) return value;
  const activeDays = new Set(value.windows.map((w) => w.day));
  const next: WindowDraft[] = value.windows.filter(
    (w) => !activeDays.has(w.day) || w.day === fromDay,
  );
  for (const day of activeDays) {
    if (day === fromDay) continue;
    for (const s of source) next.push({ key: nextKey(), day, start: s.start, end: s.end });
  }
  return { ...value, windows: next.slice(0, MAX_WINDOWS) };
}

/** "Seg a sex, 9h às 18h · sáb, 9h às 13h" — resumo legível da grade. */
export function describeHours(value: Pick<DeliveryStepValue, 'hoursEnabled' | 'windows'>): string {
  if (!value.hoursEnabled) return 'Qualquer horário, todos os dias';
  const preset = HOURS_PRESETS.find((p) => p.id === detectHoursPreset(value));
  if (preset && preset.slots !== null) return preset.detail;
  const byPattern = new Map<string, number[]>();
  for (const { day } of WEEKDAYS) {
    const slots = windowsForDay(value, day);
    if (slots.length === 0) continue;
    const pattern = slots.map((s) => `${hourText(s.start)} às ${hourText(s.end)}`).join(' e ');
    byPattern.set(pattern, [...(byPattern.get(pattern) ?? []), day]);
  }
  if (byPattern.size === 0) return 'Nenhum dia escolhido';
  return [...byPattern.entries()]
    .map(([pattern, days]) => `${daysText(days)}, ${pattern}`)
    .join(' · ');
}

function hourText(hhmm: string): string {
  const minutes = parseTimeOfDay(hhmm);
  if (minutes === null) return hhmm;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function daysText(days: readonly number[]): string {
  const order = WEEKDAYS.map((w) => w.day);
  const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const shorts = sorted.map((d) => (WEEKDAYS.find((w) => w.day === d)?.short ?? '').toLowerCase());
  const idx = sorted.map((d) => order.indexOf(d));
  const contiguous = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -2) + 1);
  if (sorted.length === 7) return 'Todos os dias';
  if (contiguous && sorted.length >= 3) {
    const first = shorts[0] ?? '';
    return `${first.charAt(0).toUpperCase()}${first.slice(1)} a ${shorts[shorts.length - 1] ?? ''}`;
  }
  const text = shorts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/* ── Valor inicial e hidratação ──────────────────────────────────────────── */

export function emptyDeliveryStep(timezone: string = DEFAULT_TIMEZONE): DeliveryStepValue {
  const business = HOURS_PRESETS[0]?.slots ?? [];
  return {
    start: 'now',
    scheduleDate: '',
    scheduleTime: '09:00',
    timezone,
    hoursEnabled: true,
    windows: toDrafts(business),
    pace: 'recommended',
    customRate: 30,
    dailyLimitEnabled: false,
    dailyLimit: DEFAULT_DAILY_LIMIT,
    deadlineEnabled: false,
    deadlineDate: '',
    deadlineTime: '18:00',
  };
}

/** Campos de `GET /api/campaigns/:id` que esta etapa lê. */
export interface StoredDelivery {
  readonly timezone: string;
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly sendWindows: {
    readonly enabled: boolean;
    readonly timezone?: string | undefined;
    readonly windows?: readonly WindowSlot[] | undefined;
  } | null;
  readonly rateLimitPerMinute: number;
  readonly dailyLimit: number | null;
}

function splitInstant(iso: string | null, timezone: string): { date: string; time: string } | null {
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  if (!isValidTimeZone(timezone)) return null;
  const date = calendarDateIn(instant, timezone);
  const wall = localDateTime(instant, timezone);
  return { date: formatCalendarDate(date), time: formatTimeOfDay(wall.hour * 60 + wall.minute) };
}

/**
 * Rascunho salvo → valor da etapa. Um fuso inválido vindo do servidor é
 * PRESERVADO (não trocado em silêncio pelo padrão): a tela mostra o problema e
 * pede uma escolha — trocar sozinho mudaria o horário do envio sem ninguém ver.
 */
export function fromStoredDelivery(stored: StoredDelivery): DeliveryStepValue {
  const timezone = stored.sendWindows?.timezone ?? stored.timezone ?? DEFAULT_TIMEZONE;
  const base = emptyDeliveryStep(timezone);
  const start = splitInstant(stored.startAt, timezone);
  const end = splitInstant(stored.endAt, timezone);
  const windows = stored.sendWindows?.windows ?? [];
  const hoursEnabled = (stored.sendWindows?.enabled ?? false) && windows.length > 0;
  const pace = paceForRate(stored.rateLimitPerMinute);
  return {
    ...base,
    start: start ? 'scheduled' : 'now',
    scheduleDate: start?.date ?? '',
    scheduleTime: start?.time ?? base.scheduleTime,
    hoursEnabled,
    windows: hoursEnabled ? toDrafts(windows) : base.windows,
    pace: pace.pace,
    customRate: pace.customRate,
    dailyLimitEnabled: stored.dailyLimit !== null,
    dailyLimit: stored.dailyLimit ?? DEFAULT_DAILY_LIMIT,
    deadlineEnabled: end !== null,
    deadlineDate: end?.date ?? '',
    deadlineTime: end?.time ?? base.deadlineTime,
  };
}

/* ── Atalhos de agendamento ──────────────────────────────────────────────── */

export interface QuickSchedule {
  readonly label: string;
  readonly date: string;
  readonly time: string;
}

/** "Amanhã, 9h" e "Próxima segunda, 9h" — no fuso da campanha. */
export function quickSchedules(now: Date, timezone: string): readonly QuickSchedule[] {
  if (!isValidTimeZone(timezone)) return [];
  const today = calendarDateIn(now, timezone);
  const tomorrow = addCalendarDays(today, 1);
  const weekday = weekdayOf(today);
  const toMonday = (8 - weekday) % 7 || 7;
  const monday = addCalendarDays(today, toMonday);
  const list: QuickSchedule[] = [
    { label: 'Amanhã, 9h', date: formatCalendarDate(tomorrow), time: '09:00' },
  ];
  if (toMonday !== 1) {
    list.push({ label: 'Próxima segunda, 9h', date: formatCalendarDate(monday), time: '09:00' });
  }
  return list;
}

export function todayIn(now: Date, timezone: string): string {
  if (!isValidTimeZone(timezone)) return '';
  return formatCalendarDate(calendarDateIn(now, timezone));
}

/* ── Validação ───────────────────────────────────────────────────────────── */

export type DeliveryField = 'timezone' | 'schedule' | 'hours' | 'pace' | 'dailyLimit' | 'deadline';

export type DeliveryIssueCode =
  | 'timezone_invalid'
  | 'schedule_missing'
  | 'schedule_invalid'
  | 'schedule_past'
  | 'hours_empty'
  | 'window_invalid'
  | 'window_overlap'
  | 'rate_invalid'
  | 'daily_limit_invalid'
  | 'deadline_missing'
  | 'deadline_invalid'
  | 'deadline_before_start'
  | 'deadline_past';

export interface DeliveryIssue {
  readonly code: DeliveryIssueCode;
  readonly field: DeliveryField;
  readonly text: string;
  /** Faixa do editor semanal, quando o problema é numa faixa. */
  readonly windowKey?: string;
}

export type ResolvedMoment =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly resolution: WallTimeResolution };

/** Data + hora digitadas → instante no fuso (com aviso de horário de verão). */
export function resolveMoment(date: string, time: string, timezone: string): ResolvedMoment {
  if (date.trim() === '' && time.trim() === '') return { kind: 'none' };
  const parsedDate = parseCalendarDate(date);
  const minute = parseTimeOfDay(time);
  if (!parsedDate || minute === null || !isValidTimeZone(timezone)) return { kind: 'invalid' };
  return { kind: 'ok', resolution: resolveWallTime(parsedDate, minute, timezone) };
}

/** Margem mínima para "agendar": menos que isso, na prática, é "agora". */
export const SCHEDULE_MIN_LEAD_MS = 60_000;

export function validateDelivery(value: DeliveryStepValue, now: Date): readonly DeliveryIssue[] {
  const issues: DeliveryIssue[] = [];
  const tzOk = isValidTimeZone(value.timezone);
  if (!tzOk) {
    issues.push({
      code: 'timezone_invalid',
      field: 'timezone',
      text: `O fuso “${value.timezone || 'vazio'}” não é reconhecido. Escolha o fuso correto para que os horários valham.`,
    });
  }

  let startInstant: Date | null = null;
  if (value.start === 'scheduled') {
    const moment = resolveMoment(value.scheduleDate, value.scheduleTime, value.timezone);
    if (moment.kind === 'none' || value.scheduleDate.trim() === '') {
      issues.push({
        code: 'schedule_missing',
        field: 'schedule',
        text: 'Escolha o dia e a hora do início.',
      });
    } else if (moment.kind === 'invalid') {
      if (tzOk) {
        issues.push({
          code: 'schedule_invalid',
          field: 'schedule',
          text: 'Essa data ou hora não é válida.',
        });
      }
    } else {
      startInstant = moment.resolution.instant;
      if (startInstant.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_MS) {
        issues.push({
          code: 'schedule_past',
          field: 'schedule',
          text: 'Esse horário já passou. Escolha um momento no futuro ou envie agora.',
        });
      }
    }
  }

  if (value.hoursEnabled) {
    if (value.windows.length === 0) {
      issues.push({
        code: 'hours_empty',
        field: 'hours',
        text: 'Marque ao menos um dia com horário, ou escolha “Qualquer horário”.',
      });
    }
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const slots = windowsForDay(value, day);
      let previousEnd = -1;
      for (const w of slots) {
        const start = parseTimeOfDay(w.start);
        const end = parseTimeOfDay(w.end);
        if (start === null || end === null || end <= start) {
          issues.push({
            code: 'window_invalid',
            field: 'hours',
            windowKey: w.key,
            text: `${weekdayLong(day)}: o horário final precisa ser depois do inicial. Para passar da meia-noite, use uma faixa em cada dia.`,
          });
          continue;
        }
        if (start < previousEnd) {
          issues.push({
            code: 'window_overlap',
            field: 'hours',
            windowKey: w.key,
            text: `${weekdayLong(day)}: duas faixas se sobrepõem. Junte-as numa só.`,
          });
        }
        previousEnd = Math.max(previousEnd, end);
      }
    }
  }

  const rate = rateForPace(value);
  if (!Number.isInteger(rate) || rate < RATE_MIN || rate > RATE_MAX) {
    issues.push({
      code: 'rate_invalid',
      field: 'pace',
      text: `Use de ${RATE_MIN} a ${RATE_MAX} mensagens por minuto.`,
    });
  }

  if (
    value.dailyLimitEnabled &&
    (!Number.isInteger(value.dailyLimit) ||
      value.dailyLimit < DAILY_LIMIT_MIN ||
      value.dailyLimit > DAILY_LIMIT_MAX)
  ) {
    issues.push({
      code: 'daily_limit_invalid',
      field: 'dailyLimit',
      text: 'Informe quantas mensagens, no máximo, podem sair por dia (a partir de 1).',
    });
  }

  if (value.deadlineEnabled) {
    const moment = resolveMoment(value.deadlineDate, value.deadlineTime, value.timezone);
    if (moment.kind === 'none' || value.deadlineDate.trim() === '') {
      issues.push({
        code: 'deadline_missing',
        field: 'deadline',
        text: 'Escolha até quando a campanha pode enviar.',
      });
    } else if (moment.kind === 'invalid') {
      if (tzOk) {
        issues.push({
          code: 'deadline_invalid',
          field: 'deadline',
          text: 'Essa data ou hora não é válida.',
        });
      }
    } else {
      const deadline = moment.resolution.instant;
      if (deadline.getTime() <= now.getTime()) {
        issues.push({ code: 'deadline_past', field: 'deadline', text: 'O prazo final já passou.' });
      } else if (startInstant && deadline.getTime() <= startInstant.getTime()) {
        issues.push({
          code: 'deadline_before_start',
          field: 'deadline',
          text: 'O prazo final precisa ser depois do início do envio.',
        });
      }
    }
  }
  return issues;
}

/* ── Payload para a API ──────────────────────────────────────────────────── */

/** Corpo parcial do `PATCH /api/campaigns/:id` (campos aceitos por `crud.ts`). */
export interface DeliveryPayload {
  readonly timezone: string;
  /** `null` = começa quando a campanha for iniciada. */
  readonly startAt: string | null;
  readonly endAt: string | null;
  readonly sendWindows: {
    readonly enabled: boolean;
    readonly timezone: string;
    readonly windows: readonly WindowSlot[];
  };
  readonly rateLimitPerMinute: number;
  /** `null` = sem limite próprio (vale a capacidade do número). */
  readonly dailyLimit: number | null;
}

/** `null` enquanto houver pendência — nunca manda meia configuração. */
export function toDeliveryPayload(value: DeliveryStepValue, now: Date): DeliveryPayload | null {
  if (validateDelivery(value, now).length > 0) return null;
  const start =
    value.start === 'scheduled'
      ? resolveMoment(value.scheduleDate, value.scheduleTime, value.timezone)
      : null;
  const end = value.deadlineEnabled
    ? resolveMoment(value.deadlineDate, value.deadlineTime, value.timezone)
    : null;
  const windows = value.hoursEnabled
    ? value.windows
        .map((w) => ({ day: w.day, start: w.start, end: w.end }))
        .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
    : [];
  return {
    timezone: value.timezone,
    startAt: start?.kind === 'ok' ? start.resolution.instant.toISOString() : null,
    endAt: end?.kind === 'ok' ? end.resolution.instant.toISOString() : null,
    sendWindows: { enabled: value.hoursEnabled, timezone: value.timezone, windows },
    rateLimitPerMinute: rateForPace(value),
    dailyLimit: value.dailyLimitEnabled ? value.dailyLimit : null,
  };
}

/* ── Estimativa e avisos ─────────────────────────────────────────────────── */

export type DeliveryNoticeCode =
  | 'quality_yellow'
  | 'quality_red'
  | 'capacity_unknown'
  | 'audience_over_capacity'
  | 'split_days'
  | 'deadline_cuts'
  | 'unfeasible'
  | 'rate_aggressive'
  | 'anytime_hours'
  | 'schedule_gap'
  | 'schedule_ambiguous'
  | 'waits_for_hours';

export type NoticeTone = 'info' | 'warn' | 'danger';

export interface DeliveryNotice {
  readonly code: DeliveryNoticeCode;
  readonly tone: NoticeTone;
  readonly title: string;
  readonly text: string;
}

export interface DeliveryForecast {
  /** Instante de início usado na conta (agora, ou o agendado). */
  readonly startAt: Date;
  readonly configuredRate: number;
  readonly effectiveRate: number;
  /** Teto diário efetivo (menor entre o seu e a capacidade do número). */
  readonly dailyCap: number | null;
  readonly dailyCapSource: 'own' | 'provider' | null;
  readonly estimate: ScheduleEstimate | null;
  readonly deadline: Date | null;
  readonly notices: readonly DeliveryNotice[];
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString(UI_LOCALE)} ${n === 1 ? one : many}`;
}

/**
 * Ritmo/teto/horários + contexto → previsão com avisos. Tudo que o resumo
 * mostra sai daqui, e por isso ele reage a cada mudança sem ida ao servidor.
 */
export function forecastDelivery(
  value: DeliveryStepValue,
  context: DeliveryContext,
  now: Date,
  overrideRate?: number,
): DeliveryForecast {
  const notices: DeliveryNotice[] = [];
  const tzOk = isValidTimeZone(value.timezone);
  const configuredRate = overrideRate ?? rateForPace(value);
  const rate = effectiveRate(
    Math.min(RATE_MAX, Math.max(RATE_MIN, Number.isFinite(configuredRate) ? configuredRate : 30)),
    context.quality,
  );

  // Início: agora, ou o agendado (horário passado não encolhe a duração).
  let startAt = now;
  if (value.start === 'scheduled') {
    const moment = resolveMoment(value.scheduleDate, value.scheduleTime, value.timezone);
    if (moment.kind === 'ok') {
      const r = moment.resolution;
      if (r.instant.getTime() > now.getTime()) startAt = r.instant;
      if (r.kind === 'gap') {
        notices.push({
          code: 'schedule_gap',
          tone: 'info',
          title: 'Esse horário não existe nesse dia',
          text: `O relógio adianta ${plural(r.shiftMinutes, 'minuto', 'minutos')} por causa do horário de verão. O envio começa no primeiro minuto depois do salto.`,
        });
      } else if (r.kind === 'ambiguous') {
        notices.push({
          code: 'schedule_ambiguous',
          tone: 'info',
          title: 'Esse horário acontece duas vezes nesse dia',
          text: 'O relógio volta uma hora no fim do horário de verão. O envio começa na primeira vez.',
        });
      }
    }
  }

  let deadline: Date | null = null;
  if (value.deadlineEnabled) {
    const moment = resolveMoment(value.deadlineDate, value.deadlineTime, value.timezone);
    if (moment.kind === 'ok') deadline = moment.resolution.instant;
  }

  const own =
    value.dailyLimitEnabled && value.dailyLimit >= 1 ? Math.floor(value.dailyLimit) : null;
  const provider = context.providerDailyLimit;
  let dailyCap: number | null = null;
  let dailyCapSource: DeliveryForecast['dailyCapSource'] = null;
  if (own !== null && (provider === null || own <= provider)) {
    dailyCap = own;
    dailyCapSource = 'own';
  } else if (provider !== null) {
    dailyCap = provider;
    dailyCapSource = 'provider';
  }

  if (context.quality === 'RED') {
    notices.push({
      code: 'quality_red',
      tone: 'danger',
      title: 'O número está com qualidade crítica no WhatsApp',
      text: 'A campanha não envia enquanto a qualidade não melhorar — começar agora pausaria na hora para proteger o número.',
    });
  } else if (context.quality === 'YELLOW') {
    notices.push({
      code: 'quality_yellow',
      tone: 'warn',
      title: 'O número está em alerta de qualidade',
      text: `Para protegê-lo, o envio segue na metade do ritmo escolhido (${plural(rate * 60, 'mensagem', 'mensagens')} por hora). A estimativa já considera isso.`,
    });
  } else if (context.quality === 'UNKNOWN') {
    notices.push({
      code: 'capacity_unknown',
      tone: 'info',
      title: 'Ainda não sabemos a capacidade do número',
      text: 'Não foi possível ler a qualidade e o volume diário do WhatsApp. A estimativa considera só as suas escolhas.',
    });
  }

  if (context.audience !== null && provider !== null && context.audience > provider) {
    notices.push({
      code: 'audience_over_capacity',
      tone: 'danger',
      title: 'O público é maior que o que o número alcança por dia',
      text: `Este número pode iniciar conversa com até ${plural(provider, 'pessoa', 'pessoas')} por dia e o público tem ${plural(context.audience, 'contato', 'contatos')}. Reduza o público para poder iniciar.`,
    });
  }

  if (rate > 0 && configuredRate > RATE_AGGRESSIVE_ABOVE) {
    notices.push({
      code: 'rate_aggressive',
      tone: 'warn',
      title: 'Ritmo agressivo',
      text: 'Acima de 60 mensagens por minuto o WhatsApp tende a derrubar a qualidade do número.',
    });
  }

  if (!value.hoursEnabled) {
    notices.push({
      code: 'anytime_hours',
      tone: 'warn',
      title: 'Pode enviar de madrugada',
      text: 'Sem horários definidos, a mensagem chega a qualquer hora. Mensagem fora de hora é a maior causa de bloqueio.',
    });
  }

  let estimate: ScheduleEstimate | null = null;
  if (tzOk && rate > 0 && context.audience !== null) {
    estimate = estimateSchedule({
      messages: context.audience,
      ratePerMinute: rate,
      dailyCap,
      windows: value.hoursEnabled
        ? value.windows.map((w) => ({ day: w.day, start: w.start, end: w.end }))
        : null,
      timeZone: value.timezone,
      startAt,
      deadline,
    });

    if (estimate.kind === 'ok') {
      if (estimate.firstSendAt.getTime() - startAt.getTime() > 5 * 60_000) {
        notices.push({
          code: 'waits_for_hours',
          tone: 'info',
          title: 'O envio espera o horário abrir',
          text: 'O início cai fora dos horários permitidos. A primeira mensagem sai quando o próximo horário abrir.',
        });
      }
      if (estimate.cutByDeadline) {
        const left = (context.audience ?? 0) - estimate.reached;
        notices.push({
          code: 'deadline_cuts',
          tone: 'danger',
          title: 'O prazo final deixa gente de fora',
          text: `Com este ritmo e estes horários, cerca de ${plural(left, 'contato fica', 'contatos ficam')} sem receber. Aumente o ritmo, amplie os horários ou estenda o prazo.`,
        });
      } else if (estimate.sendingDays > 1) {
        const reason =
          estimate.limitedBy === 'daily_cap'
            ? dailyCapSource === 'provider'
              ? `o número alcança até ${plural(dailyCap ?? 0, 'pessoa', 'pessoas')} por dia`
              : `o limite é de ${plural(dailyCap ?? 0, 'mensagem', 'mensagens')} por dia`
            : estimate.limitedBy === 'hours'
              ? 'os horários permitidos não comportam tudo num dia'
              : 'o ritmo não comporta tudo num dia';
        notices.push({
          code: 'split_days',
          tone: 'warn',
          title: `O envio vai ser dividido em ${estimate.sendingDays} dias`,
          text: `O público não cabe em um dia: ${reason}. Cada dia continua de onde o anterior parou.`,
        });
      }
    } else if (estimate.kind === 'unfeasible') {
      notices.push({
        code: 'unfeasible',
        tone: 'danger',
        title: 'Com estas escolhas o envio não termina',
        text: deadline
          ? 'Nenhuma mensagem caberia antes do prazo final. Amplie os horários ou estenda o prazo.'
          : 'Nem em um ano o público caberia. Aumente o ritmo ou amplie os horários.',
      });
    }
  }

  return {
    startAt,
    configuredRate,
    effectiveRate: rate,
    dailyCap,
    dailyCapSource,
    estimate,
    deadline,
    notices,
  };
}

/* ── Texto de duração ────────────────────────────────────────────────────── */

/** "menos de 1 minuto", "cerca de 35 minutos", "cerca de 3 h 20 min", "cerca de 2 dias". */
export function describeDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return 'menos de 1 minuto';
  if (minutes < 60) return `cerca de ${plural(minutes, 'minuto', 'minutos')}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) {
    // Acima de 3 h, o minuto é ruído: arredonda para 10 min.
    const shown = hours >= 3 ? Math.round(rest / 10) * 10 : rest;
    if (shown === 0 || shown === 60) return `cerca de ${shown === 60 ? hours + 1 : hours} h`;
    return `cerca de ${hours} h ${shown} min`;
  }
  const days = Math.round(minutes / 1_440);
  return `cerca de ${plural(Math.max(1, days), 'dia', 'dias')}`;
}

/* ── Teclado: grupo de opções com setas (UX §2.10) ───────────────────────── */

/**
 * Próximo índice num grupo de opções (padrão WAI-ARIA radiogroup): setas
 * circulam, Home/End vão às pontas. `null` = a tecla não é de navegação.
 */
export function nextOptionIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Fusos oferecidos no seletor: Brasil primeiro, o do navegador, depois os demais. */
export function timezoneGroups(
  current: string,
  browser: string,
  all: readonly string[],
): {
  readonly brazil: readonly { id: string; label: string }[];
  readonly others: readonly string[];
} {
  const brazilIds = new Set(BRAZIL_TIME_ZONES.map((z) => z.id));
  const others = all.filter((id) => !brazilIds.has(id));
  const extra = [browser, current].filter(
    (id) => isValidTimeZone(id) && !brazilIds.has(id) && !others.includes(id),
  );
  return { brazil: BRAZIL_TIME_ZONES, others: [...new Set([...extra, ...others])] };
}
