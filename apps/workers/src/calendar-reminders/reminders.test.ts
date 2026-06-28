import { describe, expect, it, vi } from 'vitest';
import {
  dueActionPending,
  dueOffsets,
  parseDueAction,
  resolveReminderOffsets,
  runReminderTick,
  DEFAULT_REMINDER_OFFSETS_MIN,
  type DueAction,
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
    type: 'meeting',
    priority: 'medium',
    contactId: 'ct-1',
    dealId: null,
    conversationId: null,
    remindersSent: [],
    dueAction: null,
    dueActionDone: false,
    ...overrides,
  };
}

function ports(over: Partial<ReminderPorts> = {}): ReminderPorts {
  return {
    selectDue: vi.fn(async () => []),
    notifyOrganizer: vi.fn(async () => {}),
    sendContactReminder: vi.fn(async () => true),
    runDueAction: vi.fn(async () => {}),
    markReminded: vi.fn(async () => {}),
    markDueActionDone: vi.fn(async () => {}),
    ...over,
  };
}

describe('resolveReminderOffsets', () => {
  it('default inclui 0 (vencimento) + 1h + 1d', () => {
    expect(resolveReminderOffsets({})).toEqual([...DEFAULT_REMINDER_OFFSETS_MIN]);
    expect(DEFAULT_REMINDER_OFFSETS_MIN).toContain(0);
  });
  it('parseia CSV do env e de-duplica', () => {
    expect(resolveReminderOffsets({ CALENDAR_REMINDER_OFFSETS_MIN: '120, 30, 30, 0' })).toEqual([
      120, 30, 0,
    ]);
  });
  it('CSV inválido cai no default', () => {
    expect(resolveReminderOffsets({ CALENDAR_REMINDER_OFFSETS_MIN: 'abc,-5' })).toEqual([
      ...DEFAULT_REMINDER_OFFSETS_MIN,
    ]);
  });
});

describe('parseDueAction', () => {
  it('valida trigger_flow', () => {
    const a = parseDueAction({ dueAction: { kind: 'trigger_flow', flowId: '11111111-1111-1111-1111-111111111111' } });
    expect(a).toEqual({ kind: 'trigger_flow', flowId: '11111111-1111-1111-1111-111111111111' });
  });
  it('aplica default de languageCode no send_message', () => {
    const a = parseDueAction({ dueAction: { kind: 'send_message', templateName: 'lembrete' } });
    expect(a).toEqual({ kind: 'send_message', templateName: 'lembrete', languageCode: 'pt_BR' });
  });
  it('ação inválida → null', () => {
    expect(parseDueAction({ dueAction: { kind: 'nope' } })).toBeNull();
    expect(parseDueAction({})).toBeNull();
    expect(parseDueAction(null)).toBeNull();
  });
});

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
  it('offset 0 (vencimento) só dispara quando start <= now', () => {
    expect(dueOffsets({ startAt: start, remindersSent: [] }, new Date('2099-01-05T12:59:00Z'), [0])).toEqual([]);
    expect(dueOffsets({ startAt: start, remindersSent: [] }, new Date('2099-01-05T13:00:00Z'), [0])).toEqual([0]);
    expect(dueOffsets({ startAt: start, remindersSent: [0] }, new Date('2099-01-05T13:05:00Z'), [0])).toEqual([]);
  });
});

describe('dueActionPending', () => {
  const action: DueAction = { kind: 'add_tag', tagId: '22222222-2222-2222-2222-222222222222' };
  it('true: tem ação, venceu, não feita', () => {
    expect(
      dueActionPending(
        { startAt: new Date('2099-01-05T13:00:00Z'), dueAction: action, dueActionDone: false },
        new Date('2099-01-05T13:00:00Z'),
      ),
    ).toBe(true);
  });
  it('false: sem ação', () => {
    expect(
      dueActionPending({ startAt: new Date('2000-01-01T00:00:00Z'), dueAction: null, dueActionDone: false }, new Date()),
    ).toBe(false);
  });
  it('false: ainda não venceu', () => {
    expect(
      dueActionPending(
        { startAt: new Date('2099-01-05T13:00:00Z'), dueAction: action, dueActionDone: false },
        new Date('2099-01-05T12:59:00Z'),
      ),
    ).toBe(false);
  });
  it('false: já executada (idempotência)', () => {
    expect(
      dueActionPending(
        { startAt: new Date('2000-01-01T00:00:00Z'), dueAction: action, dueActionDone: true },
        new Date(),
      ),
    ).toBe(false);
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

  describe('offset 0 (lembrete na hora) + due→ação', () => {
    const dueNow = new Date('2099-01-05T13:00:00Z');
    const justDue = (over: Partial<DueReminder> = {}): DueReminder =>
      reminder({ startAt: new Date('2099-01-05T13:00:00Z'), ...over });

    it('offset 0 dispara no vencimento (notifica + marca [0])', async () => {
      const p = ports({ selectDue: vi.fn(async () => [justDue()]) });
      const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
      const res = await runReminderTick(deps, { now: dueNow, offsets: [0] });
      expect(res.notified).toBe(1);
      expect(p.notifyOrganizer).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'ev-1' }), 0);
      expect(p.markReminded).toHaveBeenCalledWith('ev-1', 'ws-1', [0]);
    });

    it('offset 0 idempotente: já em remindersSent não re-dispara', async () => {
      const p = ports({ selectDue: vi.fn(async () => [justDue({ remindersSent: [0] })]) });
      const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
      const res = await runReminderTick(deps, { now: dueNow, offsets: [0] });
      expect(res.events).toBe(0);
      expect(p.notifyOrganizer).not.toHaveBeenCalled();
    });

    it('dueAction presente no vencimento → runDueAction + markDueActionDone', async () => {
      const action: DueAction = { kind: 'add_tag', tagId: '22222222-2222-2222-2222-222222222222' };
      const p = ports({ selectDue: vi.fn(async () => [justDue({ dueAction: action })]) });
      const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
      const res = await runReminderTick(deps, { now: dueNow, offsets: [0] });
      expect(res.actions).toBe(1);
      expect(p.runDueAction).toHaveBeenCalledWith(expect.objectContaining({ dueAction: action }));
      expect(p.markDueActionDone).toHaveBeenCalledWith('ev-1', 'ws-1');
    });

    it('dueAction idempotente: dueActionDone=true não re-executa', async () => {
      const action: DueAction = { kind: 'add_tag', tagId: '22222222-2222-2222-2222-222222222222' };
      const p = ports({
        selectDue: vi.fn(async () => [justDue({ dueAction: action, dueActionDone: true, remindersSent: [0] })]),
      });
      const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
      const res = await runReminderTick(deps, { now: dueNow, offsets: [0] });
      expect(res.actions).toBe(0);
      expect(p.runDueAction).not.toHaveBeenCalled();
      expect(p.markDueActionDone).not.toHaveBeenCalled();
    });

    it('falha em runDueAction NÃO marca done (retry no próximo tick)', async () => {
      const action: DueAction = { kind: 'add_tag', tagId: '22222222-2222-2222-2222-222222222222' };
      const p = ports({
        selectDue: vi.fn(async () => [justDue({ dueAction: action })]),
        runDueAction: vi.fn(async () => {
          throw new Error('port boom');
        }),
      });
      const deps: ReminderDeps = { redis: fakeRedis(true), logger, ports: p };
      const res = await runReminderTick(deps, { now: dueNow, offsets: [0] });
      expect(res.actions).toBe(0);
      expect(p.markDueActionDone).not.toHaveBeenCalled();
      // O lembrete (offset 0) ainda é marcado — idempotência de notificação independe da ação.
      expect(p.markReminded).toHaveBeenCalledWith('ev-1', 'ws-1', [0]);
    });
  });
});
