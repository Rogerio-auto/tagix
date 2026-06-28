import { describe, expect, it, vi } from 'vitest';
import type { DbTx, CreateEventInput, Event } from '@hm/db';
import type { EventChangedPayload } from '@hm/shared';
import { createCalendarEventPort, type CreateEventPortDeps, type DealEventRef } from './create-event-port';

/** tx fake — o port nunca toca nela direto (so a repassa as deps injetadas). */
const fakeTx = {} as DbTx;

function buildDeps(
  over: Partial<CreateEventPortDeps> & { deal?: DealEventRef | null } = {},
): { deps: CreateEventPortDeps; created: CreateEventInput[] } {
  const created: CreateEventInput[] = [];
  const deal = over.deal === undefined ? { contactId: 'c1', conversationId: 'cv1' } : over.deal;
  const deps: CreateEventPortDeps = {
    runScoped: over.runScoped ?? (async (_workspaceId, fn) => fn(fakeTx)),
    resolveDeal: over.resolveDeal ?? (async () => deal),
    createEvent:
      over.createEvent ??
      (async (_tx, input) => {
        created.push(input);
        return { id: 'ev1' } as Event;
      }),
    ...(over.emitCreated ? { emitCreated: over.emitCreated } : {}),
    now: over.now ?? ((): Date => new Date('2026-06-28T00:00:00.000Z')),
  };
  return { deps, created };
}

describe('createCalendarEventPort', () => {
  it('resolve startAt por offset relativo e endAt por duracao', async () => {
    const { deps, created } = buildDeps();
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'w1', dealId: 'd1' },
      { calendarId: 'cal1', title: 'Follow-up', durationMinutes: 30, offsetDays: 2 },
    );
    expect(created).toHaveLength(1);
    const input = created[0]!;
    // base 2026-06-28T00:00 + 2 dias = 2026-06-30T00:00; +30min = 00:30.
    expect(input.startAt.toISOString()).toBe('2026-06-30T00:00:00.000Z');
    expect(input.endAt.toISOString()).toBe('2026-06-30T00:30:00.000Z');
    expect(input.workspaceId).toBe('w1');
    expect(input.calendarId).toBe('cal1');
    expect(input.title).toBe('Follow-up');
    expect(input.dealId).toBe('d1');
  });

  it('deriva contato/conversa do deal e marca autor sistema (createdBy/agent = null)', async () => {
    const { deps, created } = buildDeps({ deal: { contactId: 'c9', conversationId: 'cv9' } });
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'w1', dealId: 'd1' },
      { calendarId: 'cal1', title: 'X', durationMinutes: 60, offsetDays: 0 },
    );
    const input = created[0]!;
    expect(input.contactId).toBe('c9');
    expect(input.conversationId).toBe('cv9');
    expect(input.createdBy).toBeNull();
    expect(input.createdByAgentId).toBeNull();
    expect(input.metadata).toEqual({ source: 'automation', ruleKind: 'create_event' });
  });

  it('calendarId vazio → null (repo cai no calendario default)', async () => {
    const { deps, created } = buildDeps();
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'w1', dealId: 'd1' },
      { calendarId: '', title: 'X', durationMinutes: 15, offsetDays: 1 },
    );
    expect(created[0]!.calendarId).toBeNull();
  });

  it('roda sob o scope RLS do workspace da automacao', async () => {
    const runScoped = vi.fn(async (_ws: string, fn: (tx: DbTx) => Promise<unknown>) => fn(fakeTx));
    const { deps } = buildDeps({ runScoped: runScoped as CreateEventPortDeps['runScoped'] });
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'ws-42', dealId: 'd1' },
      { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
    );
    expect(runScoped).toHaveBeenCalledWith('ws-42', expect.any(Function));
  });

  it('no-op idempotente quando o deal sumiu (sem criar evento)', async () => {
    const createEvent = vi.fn(async () => ({ id: 'ev1' }) as Event);
    const { deps } = buildDeps({ deal: null, createEvent });
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'w1', dealId: 'gone' },
      { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('emite event:created no relay com o payload correto apos criar', async () => {
    const emitCreated = vi.fn<(p: EventChangedPayload) => void>();
    const { deps } = buildDeps({ deal: { contactId: 'c9', conversationId: 'cv9' }, emitCreated });
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'ws-7', dealId: 'd1' },
      { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
    );
    expect(emitCreated).toHaveBeenCalledTimes(1);
    expect(emitCreated).toHaveBeenCalledWith({
      eventId: 'ev1',
      workspaceId: 'ws-7',
      contactId: 'c9',
      conversationId: 'cv9',
      kind: 'created',
    } satisfies EventChangedPayload);
  });

  it('NAO emite quando o deal sumiu (sem evento criado, nada a anunciar)', async () => {
    const emitCreated = vi.fn<(p: EventChangedPayload) => void>();
    const { deps } = buildDeps({ deal: null, emitCreated });
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'w1', dealId: 'gone' },
      { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
    );
    expect(emitCreated).not.toHaveBeenCalled();
  });

  it('best-effort: emitter que lança NAO derruba a automacao (evento ja criado)', async () => {
    const emitCreated = vi.fn<(p: EventChangedPayload) => void>(() => {
      throw new Error('broker down');
    });
    const { deps, created } = buildDeps({ emitCreated });
    const port = createCalendarEventPort(deps);
    await expect(
      port(
        { workspaceId: 'w1', dealId: 'd1' },
        { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
      ),
    ).resolves.toBeUndefined();
    expect(created).toHaveLength(1);
    expect(emitCreated).toHaveBeenCalledTimes(1);
  });
});
