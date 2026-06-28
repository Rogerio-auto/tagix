import { describe, expect, it, vi } from 'vitest';
import type { DbTx, CreateEventInput, Event } from '@hm/db';
import type { EventChangedPayload } from '@hm/shared';
import {
  createCalendarEventPort,
  type CreateEventPortDeps,
  type DealEventRef,
} from '../create-event-port';

/**
 * F54-S05 (adversarial) — automação `create_event` em tempo real, nos limites:
 * rajada de criações, duplicata (sem dedup, idempotência via refetch do cliente),
 * e a INVARIANTE central de confiabilidade: o emit só dispara APÓS a criação
 * commitar — nunca anuncia um evento que não existe (deal sumiu) ou que rolou back
 * (createEvent lançou).
 */

const fakeTx = {} as DbTx;

function buildDeps(
  over: Partial<CreateEventPortDeps> & { deal?: DealEventRef | null } = {},
): { deps: CreateEventPortDeps; created: CreateEventInput[] } {
  const created: CreateEventInput[] = [];
  const deal = over.deal === undefined ? { contactId: 'c1', conversationId: 'cv1' } : over.deal;
  let seq = 0;
  const deps: CreateEventPortDeps = {
    runScoped: over.runScoped ?? (async (_ws, fn) => fn(fakeTx)),
    resolveDeal: over.resolveDeal ?? (async () => deal),
    createEvent:
      over.createEvent ??
      (async (_tx, input) => {
        created.push(input);
        seq += 1;
        return { id: `ev${seq}` } as Event;
      }),
    ...(over.emitCreated ? { emitCreated: over.emitCreated } : {}),
    now: over.now ?? ((): Date => new Date('2026-06-28T00:00:00.000Z')),
  };
  return { deps, created };
}

describe('rajada de criações', () => {
  it('N invocações → N criações e N emits com eventIds distintos', async () => {
    const emitted: EventChangedPayload[] = [];
    const { deps, created } = buildDeps({ emitCreated: (p) => emitted.push(p) });
    const port = createCalendarEventPort(deps);
    for (let i = 0; i < 10; i++) {
      await port(
        { workspaceId: 'w1', dealId: `d${i}` },
        { calendarId: 'cal1', title: `T${i}`, durationMinutes: 30, offsetDays: 0 },
      );
    }
    expect(created).toHaveLength(10);
    expect(emitted).toHaveLength(10);
    const ids = new Set(emitted.map((e) => e.eventId));
    expect(ids.size).toBe(10);
    expect(emitted.every((e) => e.kind === 'created' && e.workspaceId === 'w1')).toBe(true);
  });

  it('rajada concorrente (Promise.all) preserva 1 emit por criação', async () => {
    const emitted: EventChangedPayload[] = [];
    const { deps, created } = buildDeps({ emitCreated: (p) => emitted.push(p) });
    const port = createCalendarEventPort(deps);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        port(
          { workspaceId: 'w1', dealId: `d${i}` },
          { calendarId: 'cal1', title: 'X', durationMinutes: 15, offsetDays: 1 },
        ),
      ),
    );
    expect(created).toHaveLength(8);
    expect(emitted).toHaveLength(8);
  });
});

describe('duplicata (sem dedup — idempotência delegada ao refetch)', () => {
  it('mesma config 2x → 2 criações + 2 emits (port não deduplica; documentado)', async () => {
    const emitted: EventChangedPayload[] = [];
    const { deps, created } = buildDeps({
      deal: { contactId: 'c9', conversationId: 'cv9' },
      emitCreated: (p) => emitted.push(p),
    });
    const port = createCalendarEventPort(deps);
    const cfg = { calendarId: 'cal1', title: 'Dup', durationMinutes: 30, offsetDays: 1 };
    await port({ workspaceId: 'w1', dealId: 'd1' }, cfg);
    await port({ workspaceId: 'w1', dealId: 'd1' }, cfg);
    expect(created).toHaveLength(2);
    expect(emitted).toHaveLength(2);
  });
});

describe('invariante: emit só após commit', () => {
  it('createEvent lança → erro propaga e NENHUM emit dispara (nada a anunciar)', async () => {
    const emitCreated = vi.fn<(p: EventChangedPayload) => void>();
    const { deps } = buildDeps({
      emitCreated,
      createEvent: async () => {
        throw new Error('rollback');
      },
    });
    const port = createCalendarEventPort(deps);
    await expect(
      port(
        { workspaceId: 'w1', dealId: 'd1' },
        { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
      ),
    ).rejects.toThrow('rollback');
    expect(emitCreated).not.toHaveBeenCalled();
  });

  it('runScoped que rejeita (falha de tx) → erro propaga, sem emit', async () => {
    const emitCreated = vi.fn<(p: EventChangedPayload) => void>();
    const { deps } = buildDeps({
      emitCreated,
      runScoped: async () => {
        throw new Error('tx failed');
      },
    });
    const port = createCalendarEventPort(deps);
    await expect(
      port(
        { workspaceId: 'w1', dealId: 'd1' },
        { calendarId: 'cal1', title: 'X', durationMinutes: 30, offsetDays: 1 },
      ),
    ).rejects.toThrow('tx failed');
    expect(emitCreated).not.toHaveBeenCalled();
  });
});

describe('offset no passado (compromisso vencido criado por automação)', () => {
  it('offsetDays negativo cria evento no passado e ainda emite created', async () => {
    const emitted: EventChangedPayload[] = [];
    const { deps, created } = buildDeps({ emitCreated: (p) => emitted.push(p) });
    const port = createCalendarEventPort(deps);
    await port(
      { workspaceId: 'w1', dealId: 'd1' },
      { calendarId: 'cal1', title: 'Atrasado', durationMinutes: 30, offsetDays: -2 },
    );
    expect(created[0]!.startAt.toISOString()).toBe('2026-06-26T00:00:00.000Z');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kind).toBe('created');
  });
});
