/**
 * F72-S04 (H1) — o recorte da Hoje por papel, sem banco. Prova que:
 * - SUPERVISOR (e todo papel que não é OWNER/ADMIN) recebe o predicado de visibilidade
 *   da inbox (F30) construído para ELE;
 * - a agenda é filtrada pelos calendários acessíveis para TODOS os papéis;
 * - o mês só é calculado no escopo de empresa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTx } from '@hm/db';
import type { Role } from '@hm/shared';

const h = vi.hoisted(() => ({
  visibilityCalls: [] as unknown[],
  calendarCalls: [] as unknown[],
}));

vi.mock('@hm/db', async () => {
  const { sql } = await import('drizzle-orm');
  return {
    buildVisibilityPredicate: (ctx: { memberId: string }) => {
      h.visibilityCalls.push(ctx);
      return sql`inbox_visible(${ctx.memberId})`;
    },
    calendarRepo: {
      accessibleCalendarIds: async (_tx: unknown, ctx: unknown) => {
        h.calendarCalls.push(ctx);
        return ['cal-acessivel'];
      },
    },
  };
});

const { resolveTodayScope } = await import('./today-scope');

const TX = {} as DbTx;
const viewer = (role: Role) => ({ workspaceId: 'ws-1', memberId: 'mem-1', role });

beforeEach(() => {
  h.visibilityCalls.length = 0;
  h.calendarCalls.length = 0;
});

describe('resolveTodayScope', () => {
  it('SUPERVISOR: fila da empresa recortada pela visibilidade da inbox DELE', async () => {
    const s = await resolveTodayScope(TX, viewer('SUPERVISOR'));
    expect(h.visibilityCalls).toEqual([
      { memberId: 'mem-1', role: 'SUPERVISOR', workspaceId: 'ws-1' },
    ]);
    expect(s.inboxVisibility).not.toBeNull();
    expect(s.assignedTo).toBeNull();
    expect(s.calendarIds).toEqual(['cal-acessivel']);
    expect(s.includeMonth).toBe(true);
  });

  for (const role of ['AGENT', 'READONLY'] as const) {
    it(`${role}: fila pessoal + visibilidade da inbox, sem mês`, async () => {
      const s = await resolveTodayScope(TX, viewer(role));
      expect(s.assignedTo).toBe('mem-1');
      expect(s.inboxVisibility).not.toBeNull();
      expect(s.includeMonth).toBe(false);
      expect(s.calendarIds).toEqual(['cal-acessivel']);
    });
  }

  for (const role of ['ADMIN', 'OWNER'] as const) {
    it(`${role}: sem predicado de inbox, mas a agenda AINDA passa pelos calendários acessíveis`, async () => {
      const s = await resolveTodayScope(TX, viewer(role));
      expect(s.inboxVisibility).toBeNull();
      expect(h.visibilityCalls).toHaveLength(0);
      expect(s.assignedTo).toBeNull();
      expect(s.includeMonth).toBe(true);
      expect(h.calendarCalls).toEqual([{ memberId: 'mem-1', role }]);
      expect(s.calendarIds).toEqual(['cal-acessivel']);
    });
  }
});
