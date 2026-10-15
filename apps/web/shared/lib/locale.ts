/**
 * Formatação de número, moeda e data no idioma da interface (F72-S07).
 *
 * Regra F59-S08: nenhum componente escreve locale, moeda fixa ou fuso literal. O idioma
 * é o `lang` declarado no `<html>` (o layout raiz o define a partir do market pack);
 * sem DOM (SSR, teste em node) cai em `undefined`, que é o padrão do runtime. A moeda
 * vem sempre do próprio dado (`currency` do deal, do produto, da conversão). O fuso é o
 * do navegador (nenhum `timeZone` aqui).
 *
 * Mesma semântica de `features/pipeline/board/format.ts` e `features/calendar/locale.ts`,
 * que migram para cá num slot próprio (follow-up (b) da F72-S06).
 *
 * Puro e sem `'use client'`: seguro em Server e Client Components. Entradas nulas ou
 * inválidas viram `EMPTY` ("—"), nunca "NaN" ou "Invalid Date" na tela.
 */

/** O que a interface mostra quando não há valor. */
export const EMPTY = '—';

/** Idioma da interface: o `lang` do `<html>`, ou `undefined` (padrão do runtime). */
export function uiLocale(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement.lang || undefined;
}

/** Número com separadores do idioma. `null`/não finito → `EMPTY`. */
export function formatNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat(uiLocale(), options).format(value);
}

/** Fração (0–1) como porcentagem: `0.256` → "26%". */
export function formatPercent(
  fraction: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  return formatNumber(fraction, { style: 'percent', maximumFractionDigits: 0, ...options });
}

/**
 * Valor monetário em CENTAVOS na moeda do dado. Código de moeda inválido (dado
 * legado) não quebra a tela: mostra o número com o código ao lado.
 */
export function formatMoney(
  cents: number | null | undefined,
  currency: string,
  options?: Omit<Intl.NumberFormatOptions, 'style' | 'currency'>,
): string {
  if (cents == null || !Number.isFinite(cents)) return EMPTY;
  try {
    return new Intl.NumberFormat(uiLocale(), { ...options, style: 'currency', currency }).format(
      cents / 100,
    );
  } catch {
    return `${formatNumber(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** Valor monetário em UNIDADES (ex.: custo em dólar já em float), na moeda do dado. */
export function formatMoneyUnits(
  amount: number | null | undefined,
  currency: string,
  options?: Omit<Intl.NumberFormatOptions, 'style' | 'currency'>,
): string {
  if (amount == null || !Number.isFinite(amount)) return EMPTY;
  return formatMoney(Math.round(amount * 100), currency, options);
}

/** Soma por moeda (nunca mistura moedas). Entradas sem valor são ignoradas. */
export function sumByCurrency(
  items: ReadonlyArray<{ cents: number | null | undefined; currency: string }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { cents, currency } of items) {
    if (cents == null || !Number.isFinite(cents)) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + cents);
  }
  return totals;
}

/** "R$ 1.200,00" ou "R$ 1.200,00 · US$ 300,00" quando há mais de uma moeda. Vazio → `EMPTY`. */
export function formatTotals(
  totals: ReadonlyMap<string, number>,
  options?: Omit<Intl.NumberFormatOptions, 'style' | 'currency'>,
): string {
  if (totals.size === 0) return EMPTY;
  return [...totals.entries()].map(([cur, cents]) => formatMoney(cents, cur, options)).join(' · ');
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };
const DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

/** Data e hora curtas ("12/06/2026, 13:00" em pt-BR). Inválida/nula → `EMPTY`. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DATE_TIME,
): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(uiLocale(), options).format(d) : EMPTY;
}

/** Só a data ("12 de jun. de 2026" em pt-BR). Inválida/nula → `EMPTY`. */
export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DATE,
): string {
  return formatDateTime(value, options);
}

/** Só a hora ("13:00"). Inválida/nula → `EMPTY`. */
export function formatTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = TIME,
): string {
  return formatDateTime(value, options);
}

/**
 * Valor em centavos para um campo editável, no idioma da interface e sem símbolo
 * ("1.299,90" em pt-BR). O parse de volta é tolerante a vírgula ou ponto.
 */
export function centsToInput(cents: number): string {
  return formatNumber(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
