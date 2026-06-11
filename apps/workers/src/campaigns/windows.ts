/**
 * Janelas de envio (CAMPAIGNS.md 6). Puro e testavel (sem libs externas):
 * usa Intl.DateTimeFormat para resolver dia-da-semana + HH:MM no timezone alvo.
 *
 * isInSendWindow: true se a campanha nao tem janela (envia 24/7) ou se o instante
 * cai dentro de alguma janela [start,end) do dia local.
 * nextWindowStart: proximo inicio de janela (>= now) no fuso, p/ reagendar o tick
 * em vez de tentar enviar fora da janela.
 */

export interface SendWindowSlot {
  readonly day: number;
  readonly start: string;
  readonly end: string;
}

export interface SendWindows {
  readonly enabled: boolean;
  readonly timezone?: string;
  readonly windows?: readonly SendWindowSlot[];
}

interface LocalParts {
  day: number;
  minutes: number;
}

/** Resolve dia-da-semana (0=Dom) e minutos-do-dia no timezone informado. */
export function localParts(now: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = weekdayMap[get('weekday')] ?? 0;
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // Intl pode devolver 24 a meia-noite em alguns runtimes.
  const minute = Number(get('minute'));
  return { day, minutes: hour * 60 + minute };
}

/** Converte "HH:MM" em minutos-do-dia (0..1439). NaN-safe -> 0. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  const hours = Number(h);
  const mins = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return 0;
  return hours * 60 + mins;
}

/** true se `now` cai em alguma janela do dia local (ou se janelas desabilitadas). */
export function isInSendWindow(windows: SendWindows | null | undefined, now: Date): boolean {
  if (!windows || !windows.enabled) return true;
  const slots = windows.windows ?? [];
  if (slots.length === 0) return true;
  const tz = windows.timezone ?? 'America/Sao_Paulo';
  const { day, minutes } = localParts(now, tz);
  return slots.some((w) => {
    if (w.day !== day) return false;
    const start = hhmmToMinutes(w.start);
    const end = hhmmToMinutes(w.end);
    return start <= minutes && minutes < end;
  });
}

/**
 * Proximo inicio de janela a partir de `now` (inclusive). Varre ate 7 dias a
 * frente; se nao houver nenhuma janela configurada, retorna now (sem espera).
 * Resolucao em minutos no fuso da campanha.
 */
export function nextWindowStart(windows: SendWindows | null | undefined, now: Date): Date {
  if (!windows || !windows.enabled) return now;
  const slots = windows.windows ?? [];
  if (slots.length === 0) return now;
  const tz = windows.timezone ?? 'America/Sao_Paulo';
  const { day: nowDay, minutes: nowMin } = localParts(now, tz);

  let best = Infinity;
  for (let offset = 0; offset < 7; offset++) {
    const day = (nowDay + offset) % 7;
    for (const w of slots) {
      if (w.day !== day) continue;
      const start = hhmmToMinutes(w.start);
      // minutos a partir de agora ate esse inicio.
      const deltaMin = offset * 1440 + start - nowMin;
      if (deltaMin > 0 && deltaMin < best) best = deltaMin;
      // Janela em andamento hoje (offset 0): proximo inicio efetivo e agora.
      if (offset === 0 && start <= nowMin && nowMin < hhmmToMinutes(w.end)) {
        return now;
      }
    }
  }
  if (!Number.isFinite(best)) return new Date(now.getTime() + 60_000);
  return new Date(now.getTime() + best * 60_000);
}
