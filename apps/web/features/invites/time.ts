// Locale fixo de propósito: a tela é toda em português e `undefined` renderia em en-US no servidor
// (hydration mismatch). Migrar para o market pack quando ele expuser o locale de UI.
// eslint-disable-next-line no-restricted-syntax
const RTF = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "há 3 horas" / "em 2 dias". `now` injetável para teste. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = t - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RTF.format(Math.round(diff / ms), unit);
  }
  return 'agora há pouco';
}

/** Segundos que faltam até o fim do cooldown (Retry-After ou lastSentAt + janela). */
export function secondsLeft(untilMs: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((untilMs - now) / 1000));
}
