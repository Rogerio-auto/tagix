import { describe, expect, it, vi } from 'vitest';
import {
  dueOffsets,
  runReminderTick,
  type DueReminder,
  type ReminderDeps,
  type ReminderPorts,
  type RedisLike,
} from './reminders';

const logger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
} as unknown as ReminderDeps['logger'];

/** Redis fake: lock sempre adquirido; release no-op. */
function fakeRedis(acquired = true): RedisLike {
  return {
    set: vi.fn(async () => (acquired ? 'OK' : null)),
    eval: vi.fn(async () => 1),
  } as unknown as RedisLike;
}

function reminder(overrides: Partial<DueReminder> = {}): DueReminder {
  return {
    eventId: 'ev-1',
    workspaceId: 'ws-1',
    calendarId: 'cal-1',
    title: 'Reunião',
    startAt: new Date('2099-01-05T13:00:00Z'),
    contactId: 'ct-1',
    remindersSent: [],
    ...overrides,
  };
}

function ports(over: Partial<ReminderPorts> = {}): ReminderPorts {
  return {
    selectDue: vi.fn(async () => []),
    notifyOrganizer: vi.fn(async () => {}),
    sendContactReminder: vi.fn(async () => true),
    markReminded: vi.fn(async () => {}),
    ...over,
  };
}

describe('dueOffsets', () => {
  const start = new Date('2099-01-05T13:00:00Z');
  it('retorna offset vencido (start - offset <= now) e não enviado', () => {
    const now = new Date('2099-01-05T12:30:00Z'); // 30min antes
    expect(dueOffsets({ startAt: start, remindersSent: [] }, now, [1440, 60])).toEqual([1440, 60]);
  });
  it('exclui offset já enviado (idempotência)', () => {
    const now = new Date('2099-01-05T12:30:00Z');
    expect(dueOffsets({ startAt: start, remindersSent: [60] }, now, [1440, 60])).toEqual([1440]);
  });
  it('exclui offset ainda não vencido', () => {
    const now = new Date('2099-01-05T11:30:00Z'); // 90min antes
    // 60min ainda não venceu (fireAt = 12:00, now=11:30); 1440 já venceu.
    expect(dueOffsets({ startAt: start, remindersSent: [] }, now, [1440, 60])).toEqual([1440]);
  });
});

describe('runReminderTick', () => {
  const now = new Date('2099-01-05T12:30:00Z');

  it('não roda quando o lock não é adquirido', async () => {
    const p = ports();
    const deps: ReminderDeps = { redis: fakeRedis(false), logger, ports: p };
    const res = await runReminderTick(deps, { now });
    expect(res.ran).toBe(false);
    expect(p.selectDue).not.toHaveBeenCalled();
  });

  it('notifica organizer + envia WhatsApp + marca offsets due', async () => {
    const p = ports({ selectDue: vi.fn(async () => [reminder()]) });
    const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
    const res = await runReminderTick(deps, { now, offsets: [1440, 60] });

    expect(res.ran).toBe(true);
    expect(res.events).toBe(1);
    expect(res.notified).toBe(2); // 1440 + 60
    expect(res.whatsapp).toBe(2);
    expect(p.markReminded).toHaveBeenCalledWith('ev-1', 'ws-1', [1440, 60]);
  });

  it('idempotente: offsets já enviados não re-disparam', async () => {
    const p = ports({ selectDue: vi.fn(async () => [reminder({ remindersSent: [1440, 60] })]) });
    const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
    const res = await runReminderTick(deps, { now, offsets: [1440, 60] });
    expect(res.events).toBe(0);
    expect(p.notifyOrganizer).not.toHaveBeenCalled();
    expect(p.markReminded).not.toHaveBeenCalled();
  });

  it('evento sem contato: notifica organizer mas não envia WhatsApp', async () => {
    const p = ports({
      selectDue: vi.fn(async () => [reminder({ contactId: null })]),
      sendContactReminder: vi.fn(async () => false),
    });
    const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
    const res = await runReminderTick(deps, { now, offsets: [60] });
    expect(res.notified).toBe(1);
    expect(res.whatsapp).toBe(0);
  });

  it('falha no side-effect não impede markReminded (idempotência garantida)', async () => {
    const p = ports({
      selectDue: vi.fn(async () => [reminder()]),
      notifyOrganizer: vi.fn(async () => {
        throw new Error('notify boom');
      }),
    });
    const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
    const res = await runReminderTick(deps, { now, offsets: [60] });
    expect(res.notified).toBe(0);
    expect(p.markReminded).toHaveBeenCalledWith('ev-1', 'ws-1', [60]);
  });
});
