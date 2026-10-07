import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  formatMoment,
  isValidTimeZone,
  offsetLabel,
  parseCalendarDate,
  parseTimeOfDay,
  resolveWallTime,
  timeZoneName,
  weekdayOf,
} from './timezone';

describe('isValidTimeZone', () => {
  it('aceita IANA real e recusa inventado/vazio', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('   ')).toBe(false);
  });
});

describe('datas e horas digitadas', () => {
  it('recusa data que o calendário não tem', () => {
    expect(parseCalendarDate('2026-02-31')).toBeNull();
    expect(parseCalendarDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseCalendarDate('10/11/2026')).toBeNull();
  });

  it('recusa hora fora de 00:00–23:59', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('09:60')).toBeNull();
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('soma dias atravessando mês e ano; dia da semana bate com o calendário', () => {
    expect(addCalendarDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    // 07/10/2026 é quarta-feira.
    expect(weekdayOf({ year: 2026, month: 10, day: 7 })).toBe(3);
  });
});

describe('resolveWallTime — horário lido no fuso da campanha, não no do navegador', () => {
  it('Brasília (sem horário de verão desde 2019): exato, GMT-3', () => {
    const r = resolveWallTime({ year: 2026, month: 10, day: 10 }, 9 * 60, 'America/Sao_Paulo');
    expect(r.kind).toBe('exact');
    expect(r.instant.toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('DST — início (Nova York, 08/03/2026): 02:30 não existe e avança 1 h', () => {
    const r = resolveWallTime({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, 'America/New_York');
    expect(r.kind).toBe('gap');
    if (r.kind !== 'gap') return;
    expect(r.shiftMinutes).toBe(60);
    // 03:30 EDT = 07:30Z
    expect(r.instant.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('DST — fim (Nova York, 01/11/2026): 01:30 existe duas vezes, fica com a primeira', () => {
    const r = resolveWallTime({ year: 2026, month: 11, day: 1 }, 90, 'America/New_York');
    expect(r.kind).toBe('ambiguous');
    if (r.kind !== 'ambiguous') return;
    expect(r.instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(r.laterInstant.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('DST — hemisfério sul (Santiago) e Europa (Lisboa) também resolvem', () => {
    const lisbon = resolveWallTime({ year: 2026, month: 3, day: 29 }, 60 + 30, 'Europe/Lisbon');
    expect(lisbon.kind).toBe('gap');
    const lisbonSummer = resolveWallTime({ year: 2026, month: 7, day: 1 }, 9 * 60, 'Europe/Lisbon');
    expect(lisbonSummer.instant.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('1440 = meia-noite do dia seguinte', () => {
    const r = resolveWallTime({ year: 2026, month: 10, day: 10 }, 1440, 'America/Sao_Paulo');
    expect(r.instant.toISOString()).toBe('2026-10-11T03:00:00.000Z');
  });
});

describe('rótulos', () => {
  it('mostra o deslocamento em vigor e o nome em português', () => {
    const at = new Date('2026-10-10T12:00:00Z');
    expect(offsetLabel(at, 'America/Sao_Paulo')).toBe('GMT-3');
    expect(offsetLabel(new Date('2026-07-01T12:00:00Z'), 'America/New_York')).toBe('GMT-4');
    expect(offsetLabel(new Date('2026-12-01T12:00:00Z'), 'America/New_York')).toBe('GMT-5');
    expect(timeZoneName('America/Sao_Paulo', at)).toMatch(/Brasília/u);
  });

  it('hoje / amanhã relativos ao fuso, não ao UTC', () => {
    const now = new Date('2026-10-07T23:30:00Z'); // 20:30 em Brasília, já é dia 8 em UTC
    expect(formatMoment(new Date('2026-10-08T02:00:00Z'), 'America/Sao_Paulo', now)).toBe(
      'hoje às 23:00',
    );
    expect(formatMoment(new Date('2026-10-08T12:00:00Z'), 'America/Sao_Paulo', now)).toBe(
      'amanhã às 09:00',
    );
  });
});
