import { describe, expect, it } from 'vitest';
import {
  estimateSchedule,
  intervalsForWeekday,
  type ScheduleInput,
  type WindowSlot,
} from './schedule';

const TZ = 'America/Sao_Paulo';
const BUSINESS: WindowSlot[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: '09:00',
  end: '18:00',
}));

// Quarta, 07/10/2026, 10:00 em Brasília.
const WED_10H = new Date('2026-10-07T13:00:00Z');

function input(patch: Partial<ScheduleInput>): ScheduleInput {
  return {
    messages: 100,
    ratePerMinute: 30,
    dailyCap: null,
    windows: null,
    timeZone: TZ,
    startAt: WED_10H,
    deadline: null,
    ...patch,
  };
}

describe('estimateSchedule', () => {
  it('público vazio não estima', () => {
    expect(estimateSchedule(input({ messages: 0 })).kind).toBe('empty');
  });

  it('só ritmo: 100 a 30/min termina em ~4 min (a primeira sai na hora)', () => {
    const r = estimateSchedule(input({}));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.firstSendAt.toISOString()).toBe(WED_10H.toISOString());
    // 99 intervalos de 2s = 198s → arredonda para o minuto seguinte.
    expect(r.finishesAt.toISOString()).toBe('2026-10-07T13:04:00.000Z');
    expect(r.sendingDays).toBe(1);
    expect(r.limitedBy).toBe('pace');
  });

  it('teto diário divide o envio em dias e aponta o motivo', () => {
    const r = estimateSchedule(input({ messages: 2_500, dailyCap: 1_000 }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.sendingDays).toBe(3);
    expect(r.limitedBy).toBe('daily_cap');
  });

  it('horários: começa fora do horário → espera abrir; sexta à noite pula o fim de semana', () => {
    // Sexta, 09/10/2026, 20:00 em Brasília.
    const fridayNight = new Date('2026-10-09T23:00:00Z');
    const r = estimateSchedule(input({ startAt: fridayNight, windows: BUSINESS }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // Segunda 12/10 09:00 = 12:00Z
    expect(r.firstSendAt.toISOString()).toBe('2026-10-12T12:00:00.000Z');
    expect(r.sendingDays).toBe(1);
  });

  it('horários curtos fazem o envio atravessar dias (limitado por horário)', () => {
    // 9 h × 60 × 10/min = 5.400 por dia útil
    const r = estimateSchedule(
      input({
        messages: 10_000,
        ratePerMinute: 10,
        windows: BUSINESS,
        startAt: new Date('2026-10-05T12:00:00Z'),
      }),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.sendingDays).toBe(2);
    expect(r.limitedBy).toBe('hours');
  });

  it('prazo final corta o público e diz quantos recebem', () => {
    const r = estimateSchedule(
      input({
        messages: 1_000,
        ratePerMinute: 10,
        deadline: new Date(WED_10H.getTime() + 30 * 60_000),
      }),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.cutByDeadline).toBe(true);
    expect(r.reached).toBe(300);
  });

  it('prazo antes do primeiro horário aberto = inviável', () => {
    const fridayNight = new Date('2026-10-09T23:00:00Z');
    const r = estimateSchedule(
      input({
        startAt: fridayNight,
        windows: BUSINESS,
        deadline: new Date('2026-10-11T12:00:00Z'),
      }),
    );
    expect(r).toEqual({ kind: 'unfeasible', reached: 0 });
  });

  it('nenhum dia aberto = inviável (não trava em loop)', () => {
    expect(estimateSchedule(input({ windows: [] })).kind).toBe('unfeasible');
  });

  it('DST: no domingo em que o relógio adianta, a faixa 00:00–06:00 de Nova York tem 5 h', () => {
    // 08/03/2026 — domingo, NY pula 02:00→03:00.
    const sunday: WindowSlot[] = [{ day: 0, start: '00:00', end: '06:00' }];
    const start = new Date('2026-03-08T05:00:00Z'); // 00:00 EST
    const normal = estimateSchedule(
      input({
        messages: 10_000,
        ratePerMinute: 1,
        windows: sunday,
        timeZone: 'America/New_York',
        startAt: start,
      }),
    );
    expect(normal.kind).toBe('ok');
    if (normal.kind !== 'ok') return;
    // 5 h reais = 300 mensagens no primeiro domingo; sem DST seriam 360.
    const firstDay = estimateSchedule(
      input({
        messages: 10_000,
        ratePerMinute: 1,
        windows: sunday,
        timeZone: 'America/New_York',
        startAt: start,
        deadline: new Date('2026-03-08T12:00:00Z'),
      }),
    );
    expect(firstDay.kind).toBe('ok');
    if (firstDay.kind !== 'ok') return;
    expect(firstDay.reached).toBe(300);
  });

  it('faixas sobrepostas são fundidas como no worker', () => {
    expect(
      intervalsForWeekday(
        [
          { day: 1, start: '09:00', end: '12:00' },
          { day: 1, start: '11:00', end: '14:00' },
          { day: 1, start: '15:00', end: '15:00' },
        ],
        1,
      ),
    ).toEqual([{ start: 540, end: 840 }]);
  });

  it('desempenho: 100 mil contatos com limite diário cabem no orçamento de uma tecla', () => {
    const started = performance.now();
    for (const rate of [20, 30, 60, 45]) {
      const r = estimateSchedule(
        input({ messages: 100_000, ratePerMinute: rate, dailyCap: 1_000, windows: BUSINESS }),
      );
      expect(r.kind).toBe('ok');
    }
    expect(performance.now() - started).toBeLessThan(400);
  });
});
