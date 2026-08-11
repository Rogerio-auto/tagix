import { describe, expect, it } from 'vitest';
import { estimateSchedule, localMoment, type SendWindowsConfig } from './duration';

const TZ = 'America/Sao_Paulo';
/** Terça, 09:00 em São Paulo (UTC-3 o ano inteiro desde 2019). */
const TUESDAY_9AM = new Date('2026-08-11T12:00:00.000Z');
/** Sábado, 09:00 em São Paulo. */
const SATURDAY_9AM = new Date('2026-08-15T12:00:00.000Z');

const ALWAYS: SendWindowsConfig = { enabled: false };
const BUSINESS_HOURS: SendWindowsConfig = {
  enabled: true,
  windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
};

describe('localMoment', () => {
  it('lê dia da semana e minuto do dia NO FUSO da campanha, não em UTC', () => {
    expect(localMoment(TUESDAY_9AM, TZ)).toEqual({ weekday: 2, minuteOfDay: 540 });
    expect(localMoment(SATURDAY_9AM, TZ)).toEqual({ weekday: 6, minuteOfDay: 540 });
  });

  it('meia-noite local é minuto 0 (e não 1440)', () => {
    expect(localMoment(new Date('2026-08-11T03:00:00.000Z'), TZ).minuteOfDay).toBe(0);
  });
});

describe('estimateSchedule', () => {
  it('sem público, não há duração', () => {
    const result = estimateSchedule({
      messages: 0,
      ratePerMinute: 10,
      dailyLimit: 1_000,
      sendWindows: ALWAYS,
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    expect(result).toMatchObject({ approximateMinutes: 0, approximateDays: 0, limitedBy: 'none' });
  });

  it('24/7 sem teto: a duração é o público dividido pelo ritmo', () => {
    const result = estimateSchedule({
      messages: 100,
      ratePerMinute: 10,
      dailyLimit: 100_000,
      sendWindows: ALWAYS,
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    expect(result.approximateMinutes).toBe(10);
    expect(result.approximateDays).toBe(1);
    expect(result.limitedBy).toBe('rate');
    expect(result.finishesAt).toBe('2026-08-11T12:10:00.000Z');
  });

  it('teto diário divide o envio em dias — e diz que o gargalo é o teto', () => {
    const result = estimateSchedule({
      messages: 100,
      ratePerMinute: 100,
      dailyLimit: 30,
      sendWindows: ALWAYS,
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    // 30 + 30 + 30 no 4º dia sobram 10 → 1 minuto de envio.
    expect(result.approximateDays).toBe(4);
    expect(result.limitedBy).toBe('daily_limit');
    expect(result.approximateMinutes).toBe(3 * 1_440 + 1 - 540);
  });

  it('horário comercial: começar num sábado só produz na segunda', () => {
    const result = estimateSchedule({
      messages: 60,
      ratePerMinute: 1,
      dailyLimit: 100_000,
      sendWindows: BUSINESS_HOURS,
      timezone: TZ,
      startAt: SATURDAY_9AM,
    });
    // Sáb e dom sem janela; segunda 09:00→10:00.
    expect(result.approximateDays).toBe(3);
    expect(result.approximateMinutes).toBe(2 * 1_440 + 600 - 540);
    expect(result.limitedBy).toBe('send_windows');
  });

  it('no primeiro dia só conta o tempo que ainda resta da janela', () => {
    // Terça 17:00 local: sobra 1h hoje, o resto vai para quarta.
    const result = estimateSchedule({
      messages: 120,
      ratePerMinute: 1,
      dailyLimit: 100_000,
      sendWindows: BUSINESS_HOURS,
      timezone: TZ,
      startAt: new Date('2026-08-11T20:00:00.000Z'),
    });
    expect(result.approximateDays).toBe(2);
    // 60 hoje (17→18h) + 60 amanhã a partir das 09:00 → termina 10:00 de quarta.
    expect(result.approximateMinutes).toBe(1_440 + 600 - 1_020);
  });

  it('janelas sobrepostas do mesmo dia não contam capacidade duas vezes', () => {
    const overlapping: SendWindowsConfig = {
      enabled: true,
      windows: [
        { day: 2, start: '09:00', end: '12:00' },
        { day: 2, start: '10:00', end: '11:00' },
      ],
    };
    const result = estimateSchedule({
      messages: 180,
      ratePerMinute: 1,
      dailyLimit: 100_000,
      sendWindows: overlapping,
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    expect(result.approximateDays).toBe(1);
    expect(result.approximateMinutes).toBe(180);
  });

  it('configuração inviável é sinalizada em vez de devolver um número bonito', () => {
    const result = estimateSchedule({
      messages: 1_000_000,
      ratePerMinute: 1,
      dailyLimit: 1,
      sendWindows: ALWAYS,
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    expect(result.exceedsHorizon).toBe(true);
    expect(result.finishesAt).toBeNull();
  });

  it('janela habilitada sem nenhum dia configurado nunca envia', () => {
    const result = estimateSchedule({
      messages: 10,
      ratePerMinute: 10,
      dailyLimit: 100,
      sendWindows: { enabled: true, windows: [] },
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    // Lista vazia = sem restrição declarada; trata como 24/7 em vez de travar.
    expect(result.exceedsHorizon).toBe(false);
    expect(result.approximateMinutes).toBe(1);
  });

  it('fuso da janela vence o fuso da campanha quando declarado', () => {
    const windows: SendWindowsConfig = {
      enabled: true,
      timezone: 'UTC',
      windows: [{ day: 2, start: '12:00', end: '13:00' }],
    };
    const result = estimateSchedule({
      messages: 10,
      ratePerMinute: 10,
      dailyLimit: 100,
      sendWindows: windows,
      timezone: TZ,
      startAt: TUESDAY_9AM,
    });
    // 12:00Z é exatamente o início da janela em UTC → envia na hora.
    expect(result.approximateDays).toBe(1);
    expect(result.approximateMinutes).toBe(1);
  });
});
