import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DURATION_MIN,
  QUICK_DATE_OPTIONS,
  addMinutes,
  fromLocalParts,
  resolveQuickDate,
  toLocalParts,
  type QuickDateShortcut,
} from './quickDates';

/**
 * F53-S03 — atalhos de data PUROS. Cobre cada atalho + bordas (virada de dia,
 * de mês, de ano, segunda→segunda). Usamos um `now` fixo em horário LOCAL para
 * que os asserts não dependam do fuso da máquina de CI: derivamos o esperado das
 * mesmas APIs locais de Date.
 */

/** Início local esperado para um dia/hora; usado p/ comparar com o resultado ISO. */
function localStart(year: number, monthIndex: number, day: number, hour: number): string {
  return new Date(year, monthIndex, day, hour, 0, 0, 0).toISOString();
}

describe('resolveQuickDate', () => {
  it('Hoje 17h → hoje às 17:00 local, +30min', () => {
    const now = new Date(2026, 5, 27, 9, 12, 34); // 27/jun/2026 09:12 local
    const r = resolveQuickDate('today_17h', now);
    expect(r).not.toBeNull();
    expect(r?.startAt).toBe(localStart(2026, 5, 27, 17));
    expect(r?.endAt).toBe(addMinutes(localStart(2026, 5, 27, 17), DEFAULT_DURATION_MIN));
  });

  it('Hoje 17h funciona mesmo já tarde da noite (sem vazar p/ o dia seguinte)', () => {
    const now = new Date(2026, 5, 27, 23, 50, 0);
    const r = resolveQuickDate('today_17h', now);
    expect(r?.startAt).toBe(localStart(2026, 5, 27, 17));
  });

  it('Amanhã → dia seguinte às 09:00 local', () => {
    const now = new Date(2026, 5, 27, 14, 0, 0);
    const r = resolveQuickDate('tomorrow', now);
    expect(r?.startAt).toBe(localStart(2026, 5, 28, 9));
  });

  it('Amanhã vira o mês (31/jan → 01/fev)', () => {
    const now = new Date(2026, 0, 31, 14, 0, 0);
    const r = resolveQuickDate('tomorrow', now);
    expect(r?.startAt).toBe(localStart(2026, 1, 1, 9));
  });

  it('Amanhã vira o ano (31/dez → 01/jan do ano seguinte)', () => {
    const now = new Date(2026, 11, 31, 22, 0, 0);
    const r = resolveQuickDate('tomorrow', now);
    expect(r?.startAt).toBe(localStart(2027, 0, 1, 9));
  });

  it('Daqui 3 dias → +3 dias às 09:00, atravessando a virada de mês', () => {
    const now = new Date(2026, 1, 27, 8, 0, 0); // 27/fev/2026 (2026 não bissexto → fev tem 28)
    const r = resolveQuickDate('in_3_days', now);
    expect(r?.startAt).toBe(localStart(2026, 2, 2, 9)); // 02/mar
  });

  it('Próxima semana → próxima segunda às 09:00 (quarta → seg seguinte)', () => {
    const now = new Date(2026, 5, 24, 10, 0, 0); // 24/jun/2026 é uma quarta
    expect(now.getDay()).toBe(3);
    const r = resolveQuickDate('next_week', now);
    expect(r?.startAt).toBe(localStart(2026, 5, 29, 9)); // segunda 29/jun
  });

  it('Próxima semana de uma segunda salta +7 (nunca o mesmo dia)', () => {
    const now = new Date(2026, 5, 29, 10, 0, 0); // 29/jun/2026 é uma segunda
    expect(now.getDay()).toBe(1);
    const r = resolveQuickDate('next_week', now);
    expect(r?.startAt).toBe(localStart(2026, 6, 6, 9)); // segunda seguinte 06/jul
  });

  it('Próxima semana de um domingo → segunda do dia seguinte', () => {
    const now = new Date(2026, 5, 28, 10, 0, 0); // 28/jun/2026 é um domingo
    expect(now.getDay()).toBe(0);
    const r = resolveQuickDate('next_week', now);
    expect(r?.startAt).toBe(localStart(2026, 5, 29, 9));
  });

  it('Próximo mês → dia 1 do mês seguinte às 09:00', () => {
    const now = new Date(2026, 5, 15, 10, 0, 0);
    const r = resolveQuickDate('next_month', now);
    expect(r?.startAt).toBe(localStart(2026, 6, 1, 9));
  });

  it('Próximo mês vira o ano (dez → jan do ano seguinte)', () => {
    const now = new Date(2026, 11, 20, 10, 0, 0);
    const r = resolveQuickDate('next_month', now);
    expect(r?.startAt).toBe(localStart(2027, 0, 1, 9));
  });

  it('Personalizar → null (operador define manualmente)', () => {
    expect(resolveQuickDate('custom', new Date())).toBeNull();
  });

  it('todos os atalhos não-custom produzem endAt = startAt + 30min', () => {
    const now = new Date(2026, 5, 27, 9, 0, 0);
    const shortcuts: QuickDateShortcut[] = [
      'today_17h',
      'tomorrow',
      'in_3_days',
      'next_week',
      'next_month',
    ];
    for (const s of shortcuts) {
      const r = resolveQuickDate(s, now);
      expect(r).not.toBeNull();
      const diff = new Date(r!.endAt).getTime() - new Date(r!.startAt).getTime();
      expect(diff).toBe(DEFAULT_DURATION_MIN * 60_000);
    }
  });
});

describe('QUICK_DATE_OPTIONS', () => {
  it('expõe os 6 atalhos do spec, terminando em Personalizar', () => {
    expect(QUICK_DATE_OPTIONS.map((o) => o.id)).toEqual([
      'today_17h',
      'tomorrow',
      'in_3_days',
      'next_week',
      'next_month',
      'custom',
    ]);
    expect(QUICK_DATE_OPTIONS.at(-1)?.id).toBe('custom');
  });
});

describe('toLocalParts / fromLocalParts', () => {
  it('round-trip: partes locais → ISO → mesmas partes', () => {
    const iso = fromLocalParts('2026-06-27', '17:00');
    expect(iso).not.toBeNull();
    expect(toLocalParts(iso!)).toEqual({ date: '2026-06-27', time: '17:00' });
  });

  it('fromLocalParts devolve null para entrada incompleta ou inválida', () => {
    expect(fromLocalParts('', '17:00')).toBeNull();
    expect(fromLocalParts('2026-06-27', '')).toBeNull();
    expect(fromLocalParts('not-a-date', '99:99')).toBeNull();
  });

  it('toLocalParts é tolerante a ISO inválido', () => {
    expect(toLocalParts('lixo')).toEqual({ date: '', time: '' });
  });
});
