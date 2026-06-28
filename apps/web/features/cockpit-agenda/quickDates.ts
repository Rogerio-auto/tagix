/**
 * Lógica PURA de atalhos de data do agendamento rápido (F53-S03). Sem React, sem
 * I/O — recebe um `now` injetável para ser 100% determinística e testável.
 *
 * Cada atalho resolve para uma janela `{ startAt, endAt }` em ISO (UTC `Z`, que a
 * API aceita: `z.string().datetime({ offset: true })` admite o sufixo `Z`). Os
 * cálculos de hora usam o fuso LOCAL do browser (setHours), espelhando o que o
 * operador vê nos pickers `date`/`time`.
 */

/** Duração default de um compromisso rápido (min). endAt = startAt + isto. */
export const DEFAULT_DURATION_MIN = 30;

/** Hora padrão (local) dos atalhos que não fixam horário próprio. */
const DEFAULT_HOUR = 9;
/** Hora do atalho "Hoje 17h". */
const TODAY_HOUR = 17;

export type QuickDateShortcut =
  | 'today_17h'
  | 'tomorrow'
  | 'in_3_days'
  | 'next_week'
  | 'next_month'
  | 'custom';

export interface QuickDateResult {
  /** Início do compromisso (ISO). */
  readonly startAt: string;
  /** Fim = início + DEFAULT_DURATION_MIN (ISO). */
  readonly endAt: string;
}

export interface QuickDateOption {
  readonly id: QuickDateShortcut;
  readonly label: string;
}

/** Atalhos exibidos como chips, na ordem. `custom` = edição manual dos pickers. */
export const QUICK_DATE_OPTIONS: readonly QuickDateOption[] = [
  { id: 'today_17h', label: 'Hoje 17h' },
  { id: 'tomorrow', label: 'Amanhã' },
  { id: 'in_3_days', label: 'Daqui 3 dias' },
  { id: 'next_week', label: 'Próxima semana' },
  { id: 'next_month', label: 'Próximo mês' },
  { id: 'custom', label: 'Personalizar' },
];

/** Soma `minutes` a um ISO e devolve outro ISO (UTC). */
export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Empacota um `Date` de início como janela `{ startAt, endAt }` ISO. */
function windowFrom(start: Date): QuickDateResult {
  const startAt = start.toISOString();
  return { startAt, endAt: addMinutes(startAt, DEFAULT_DURATION_MIN) };
}

/**
 * Resolve um atalho para uma janela ISO. `custom` devolve `null` (o operador
 * define data/hora à mão). `now` é injetável p/ testes — default: agora.
 */
export function resolveQuickDate(
  shortcut: QuickDateShortcut,
  now: Date = new Date(),
): QuickDateResult | null {
  switch (shortcut) {
    case 'today_17h': {
      const d = new Date(now);
      d.setHours(TODAY_HOUR, 0, 0, 0);
      return windowFrom(d);
    }
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(DEFAULT_HOUR, 0, 0, 0);
      return windowFrom(d);
    }
    case 'in_3_days': {
      const d = new Date(now);
      d.setDate(d.getDate() + 3);
      d.setHours(DEFAULT_HOUR, 0, 0, 0);
      return windowFrom(d);
    }
    case 'next_week': {
      // Próxima segunda-feira (sempre no futuro: se hoje já é segunda, +7).
      const d = new Date(now);
      const day = d.getDay(); // 0=Dom..6=Sáb
      const daysUntilNextMonday = (8 - day) % 7 || 7;
      d.setDate(d.getDate() + daysUntilNextMonday);
      d.setHours(DEFAULT_HOUR, 0, 0, 0);
      return windowFrom(d);
    }
    case 'next_month': {
      // Dia 1 do próximo mês (o construtor normaliza a virada de ano).
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, DEFAULT_HOUR, 0, 0, 0);
      return windowFrom(d);
    }
    case 'custom':
      return null;
  }
}

/**
 * ISO → partes locais para os inputs `date` (YYYY-MM-DD) e `time` (HH:mm),
 * no fuso do browser. Espelha o `toLocalInput` do EventForm.
 */
export function toLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  const s = local.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/**
 * Partes locais (`date`+`time`) → ISO (UTC) para persistir. `null` se inválidas
 * ou incompletas — o chamador trata como erro de validação.
 */
export function fromLocalParts(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
