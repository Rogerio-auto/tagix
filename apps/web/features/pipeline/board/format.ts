import type { Deal, Stage } from './types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A partir de quantos dias parado numa etapa o card pede atenção (tom `warn`). */
export const STALE_AFTER_DAYS = 7;

/**
 * Idioma da interface = o `lang` declarado no <html> (o app define no layout raiz), nunca
 * um literal no componente. `undefined` cai no padrão do runtime (SSR/teste sem DOM).
 */
export function uiLocale(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement.lang || undefined;
}

/**
 * Valor monetário do deal. O board só renderiza depois do fetch, no cliente, então não há
 * descompasso de hidratação. A moeda vem do próprio deal (nunca fixa).
 */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(uiLocale(), { style: 'currency', currency }).format(cents / 100);
  } catch {
    // Código de moeda inválido vindo de dado legado: mostra o número, sem quebrar o card.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Quando o deal entrou na etapa atual. A API não guarda `stage_entered_at`; o `updatedAt`
 * é movido a cada move-stage (e por edições de campo), então é uma aproximação por baixo
 * do tempo real. Cai em `createdAt` para deal nunca editado.
 */
export function stageSinceMs(deal: Pick<Deal, 'updatedAt' | 'createdAt'>): number | null {
  const iso = deal.updatedAt ?? deal.createdAt;
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export interface StageAge {
  /** Forma compacta e neutra de idioma: `<1h`, `5h`, `3d`, `6sem`. */
  short: string;
  /** Texto para leitor de tela. */
  long: string;
  /** Dias inteiros na etapa. */
  days: number;
  stale: boolean;
}

export function stageAge(deal: Pick<Deal, 'updatedAt' | 'createdAt'>, nowMs: number): StageAge | null {
  const since = stageSinceMs(deal);
  if (since === null) return null;
  const elapsed = Math.max(0, nowMs - since);
  const days = Math.floor(elapsed / DAY_MS);
  const hours = Math.floor(elapsed / HOUR_MS);
  let short: string;
  let long: string;
  if (days >= 14) {
    const weeks = Math.floor(days / 7);
    short = `${weeks}sem`;
    long = `${weeks} semanas`;
  } else if (days >= 1) {
    short = `${days}d`;
    long = days === 1 ? '1 dia' : `${days} dias`;
  } else if (hours >= 1) {
    short = `${hours}h`;
    long = hours === 1 ? '1 hora' : `${hours} horas`;
  } else {
    short = '<1h';
    long = 'menos de 1 hora';
  }
  return { short, long, days, stale: days >= STALE_AFTER_DAYS };
}

/** Soma de valores por moeda (nunca mistura moedas). */
export function sumByCurrency(deals: readonly Deal[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const d of deals) {
    if (d.valueCents <= 0) continue;
    totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.valueCents);
  }
  return totals;
}

/** "R$ 1.200,00" ou "R$ 1.200,00 · US$ 300,00" quando há mais de uma moeda. `null` sem valor. */
export function formatTotals(deals: readonly Deal[]): string | null {
  const totals = sumByCurrency(deals);
  if (totals.size === 0) return null;
  return [...totals.entries()].map(([cur, cents]) => formatMoney(cents, cur)).join(' · ');
}

/** Deals "em aberto" = fora de etapas de ganho/perda. */
export function openDeals(deals: readonly Deal[], stages: readonly Stage[]): Deal[] {
  const closed = new Set(stages.filter((s) => s.isWon || s.isLost).map((s) => s.id));
  return deals.filter((d) => !closed.has(d.stageId));
}
