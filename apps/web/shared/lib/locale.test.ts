/**
 * F72-S07 — formatadores sem locale literal. O idioma vem do `<html lang>`; sem DOM
 * cai no padrão do runtime. Os testes fixam o `lang` por um `document` mínimo.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY,
  centsToInput,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyUnits,
  formatNumber,
  formatPercent,
  formatTime,
  formatTotals,
  sumByCurrency,
  uiLocale,
} from './locale';

/** Espaços do Intl (NBSP / NNBSP) viram espaço comum para comparar. */
const norm = (s: string): string => s.replace(/[  ]/g, ' ');

function withLang(lang: string): void {
  Reflect.set(globalThis, 'document', { documentElement: { lang } });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document');
});

describe('uiLocale', () => {
  it('sem DOM devolve undefined (padrão do runtime)', () => {
    expect(uiLocale()).toBeUndefined();
  });

  it('lê o lang do <html>; vazio vira undefined', () => {
    withLang('pt-BR');
    expect(uiLocale()).toBe('pt-BR');
    withLang('');
    expect(uiLocale()).toBeUndefined();
  });
});

describe('número e moeda', () => {
  it('formata no idioma da interface', () => {
    withLang('pt-BR');
    expect(formatNumber(12345.5)).toBe('12.345,5');
    expect(formatPercent(0.256)).toBe('26%');
    expect(norm(formatMoney(129_990, 'BRL'))).toBe('R$ 1.299,90');
    expect(norm(formatMoneyUnits(1.5, 'USD'))).toBe('US$ 1,50');
    expect(centsToInput(129_990)).toBe('1.299,90');
  });

  it('a moeda vem do dado, não do idioma', () => {
    withLang('en-US');
    expect(formatMoney(129_990, 'BRL')).toBe('R$1,299.90');
    expect(formatMoney(129_990, 'USD')).toBe('$1,299.90');
  });

  it('nulo, NaN e infinito viram traço', () => {
    expect(formatNumber(null)).toBe(EMPTY);
    expect(formatNumber(Number.NaN)).toBe(EMPTY);
    expect(formatMoney(undefined, 'BRL')).toBe(EMPTY);
    expect(formatMoney(Number.POSITIVE_INFINITY, 'BRL')).toBe(EMPTY);
  });

  it('código de moeda inválido não quebra: número + código', () => {
    withLang('pt-BR');
    expect(formatMoney(1000, 'XX')).toBe('10,00 XX');
  });

  it('soma por moeda sem misturar e junta os totais', () => {
    withLang('pt-BR');
    const totals = sumByCurrency([
      { cents: 1000, currency: 'BRL' },
      { cents: null, currency: 'BRL' },
      { cents: 2000, currency: 'BRL' },
      { cents: 500, currency: 'USD' },
    ]);
    expect(totals.get('BRL')).toBe(3000);
    expect(totals.get('USD')).toBe(500);
    expect(norm(formatTotals(totals))).toBe('R$ 30,00 · US$ 5,00');
    expect(formatTotals(new Map())).toBe(EMPTY);
  });
});

describe('data e hora', () => {
  // Meio-dia UTC: a data não muda em nenhum fuso de -11h a +11h.
  const ISO = '2026-06-12T12:00:00.000Z';

  it('data no idioma da interface', () => {
    withLang('pt-BR');
    expect(formatDate(ISO)).toMatch(/^12 de jun\.? de 2026$/);
    expect(formatDateTime(ISO, { dateStyle: 'short' })).toBe('12/06/2026');
  });

  it('hora com 2 dígitos', () => {
    withLang('pt-BR');
    expect(formatTime(ISO)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('vazio ou inválido vira traço', () => {
    expect(formatDateTime(null)).toBe(EMPTY);
    expect(formatDateTime('')).toBe(EMPTY);
    expect(formatDate('não é data')).toBe(EMPTY);
  });
});
