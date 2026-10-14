/**
 * F72-S04 — o recorte por papel acontece no SERVIDOR, nas rotas `/api/dashboard/home`
 * e `/api/dashboard/today`. Router de verdade, HTTP de verdade (supertest); auth e
 * carga mockadas, sem banco: roda em qualquer ambiente.
 *
 * A carga da Home falsa entrega os agregados da EMPRESA para todo papel (cenário de
 * vazamento) e passa pela projeção real (`buildHomePayload`): o que chega ao cliente
 * é o que um AGENT receberia se a carga errasse.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@hm/shared';

const h = vi.hoisted(() => ({
  todayCalls: [] as unknown[],
  homeCalls: [] as unknown[],
  meCalls: [] as unknown[],
  drillCalls: [] as unknown[],
}));

const RECEITA_EMPRESA = 987_654_321;
const MEMBER_ID = '00000000-0000-0000-0000-00000000a6e7';

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { auth?: unknown }).auth = {
      workspace: { id: 'ws-home' },
      member: { id: MEMBER_ID, role: req.header('x-test-role') ?? 'AGENT' },
    };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tx: 'scoped' });
    next();
  },
}));

// A rota não toca o banco: o recorte da Hoje é resolvido dentro de `loadToday`
// (mockado aqui; o resolvedor tem teste próprio em `today-scope.test.ts`).
vi.mock('@hm/db', () => ({}));

vi.mock('./today-actions', async () => {
  const { Router } = await import('express');
  return { createTodayActionsRouter: () => Router() };
});

vi.mock('./today', () => ({
  loadToday: vi.fn(async (_tx: unknown, input: { viewer: { role: Role } }) => {
    h.todayCalls.push(input);
    const personal = input.viewer.role === 'AGENT' || input.viewer.role === 'READONLY';
    return {
      waiting: [],
      waitingTotal: 0,
      waitingBands: { esfriando: 0, atencao: 0, agora: 0 },
      appointments: [],
      // Espelha o contrato real: recorte pessoal não calcula o mês.
      month: personal
        ? null
        : {
            leads: 10,
            leadsPrevious: 8,
            appointments: 2,
            appointmentsPrevious: 1,
            conversations: 9,
            conversationsPrevious: 7,
          },
      serverTime: '2026-09-15T18:00:00.000Z',
    };
  }),
}));

vi.mock('../../services/dashboard', async () => {
  const model = await import('../../services/dashboard/home-model');
  return {
    homeScopeForRole: model.homeScopeForRole,
    loadDashboard: vi.fn(async (_tx: unknown, args: unknown) => {
      h.meCalls.push(args);
      return { cards: [] };
    }),
    drillDown: vi.fn(async (_tx: unknown, args: { metricKey: string }) => {
      h.drillCalls.push(args);
      return { kind: 'ok', metricKey: args.metricKey, detail: { rows: [] } };
    }),
    loadHome: vi.fn(
      async (_tx: unknown, args: { role: Role; periodDays?: 7 | 30 | 90; memberId: string }) => {
        h.homeCalls.push(args);
        const stl = {
          current: { medianSeconds: 60, answered: 3, unanswered: 1 },
          previous: { medianSeconds: 120, answered: 1, unanswered: 0 },
        };
        return model.buildHomePayload({
          role: args.role,
          now: new Date('2026-09-15T18:00:00Z'),
          periodDays: args.periodDays ?? model.HOME_PERIOD_DAYS,
          sla: { minutes: 15, source: 'default' },
          workspace: {
            hasConversionTypes: true,
            revenueCents: { current: RECEITA_EMPRESA, previous: 1 },
            conversions: { current: 3, previous: 2 },
            leads: { current: 40, previous: 30 },
            speedToLead: stl,
            journey: { leads: 40, conversations: 30, booked: 5, won: 3 },
            revenueSeries: [{ day: '2026-09-15', valueCents: RECEITA_EMPRESA }],
          },
          personal: { open: 2, waiting: 1, resolvedToday: 0, speedToLead: stl },
          attention: {
            waiting: { count: 0, oldestAt: null, oldestConversationId: null },
            stalledDeals: { count: 0, oldestDealId: null },
            channelDown: { count: 1, onlyChannelId: 'chan-1', metaLoginExpired: false },
            mediaFailed: { count: 0, latestConversationId: null },
          },
        });
      },
    ),
  };
});

const { createDashboardRouter } = await import('./index');

function app(): express.Express {
  const a = express();
  a.use(createDashboardRouter());
  return a;
}

const COST_TERMS = ['cost', 'custo', 'usd', 'llm', 'token', 'roi', 'cap_mensal'];

beforeEach(() => {
  h.todayCalls.length = 0;
  h.homeCalls.length = 0;
  h.meCalls.length = 0;
  h.drillCalls.length = 0;
});

describe('GET /api/dashboard/home — recorte por papel no servidor', () => {
  for (const role of ['AGENT', 'READONLY'] as const) {
    it(`${role} recebe só a fila dele: sem receita, jornada, série, canal ou custo`, async () => {
      const res = await request(app()).get('/api/dashboard/home').set('x-test-role', role);
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('personal');
      expect(res.body.journey).toBeNull();
      expect(res.body.revenueSeries).toBeNull();
      const keys = (res.body.kpis as { key: string }[]).map((k) => k.key);
      for (const owner of ['revenue', 'leads', 'conversions']) expect(keys).not.toContain(owner);
      const raw = res.text.toLowerCase();
      expect(raw).not.toContain(String(RECEITA_EMPRESA));
      expect(raw).not.toContain('channel_down');
      for (const term of COST_TERMS) expect(raw, `${role} recebeu ${term}`).not.toContain(term);
    });
  }

  for (const role of ['ADMIN', 'OWNER'] as const) {
    it(`${role} recebe o resultado da empresa e a saúde de canal`, async () => {
      const res = await request(app()).get('/api/dashboard/home').set('x-test-role', role);
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('workspace');
      const revenue = (res.body.kpis as { key: string; value: number }[]).find(
        (k) => k.key === 'revenue',
      );
      expect(revenue?.value).toBe(RECEITA_EMPRESA);
      expect(res.body.journey).not.toBeNull();
      expect((res.body.attention as { kind: string }[]).map((a) => a.kind)).toContain(
        'channel_down',
      );
      for (const term of COST_TERMS) expect(res.text.toLowerCase()).not.toContain(term);
    });
  }

  it('o papel vem da sessão validada, e não de parâmetro do cliente', async () => {
    await request(app()).get('/api/dashboard/home?role=OWNER').set('x-test-role', 'AGENT');
    expect(h.homeCalls).toEqual([
      expect.objectContaining({ role: 'AGENT', memberId: MEMBER_ID, periodDays: 30 }),
    ]);
  });

  it('papel fora da matriz é 403 (fail-closed), sem carregar nada', async () => {
    const res = await request(app()).get('/api/dashboard/home').set('x-test-role', 'ROOT');
    expect(res.status).toBe(403);
    expect(h.homeCalls).toHaveLength(0);
  });

  it('valida o período com Zod: 7d/30d/90d aceitos, o resto é 400', async () => {
    const ok = await request(app())
      .get('/api/dashboard/home?period=7d')
      .set('x-test-role', 'OWNER');
    expect(ok.status).toBe(200);
    expect(ok.body.periodDays).toBe(7);
    expect(h.homeCalls).toEqual([expect.objectContaining({ periodDays: 7 })]);

    for (const bad of ['period=365d', 'period=7', 'period=7d&period=30d', 'period=']) {
      const res = await request(app())
        .get(`/api/dashboard/home?${bad}`)
        .set('x-test-role', 'OWNER');
      expect(res.status, bad).toBe(400);
    }
  });

  it('resposta não vai para cache compartilhado', async () => {
    const res = await request(app()).get('/api/dashboard/home').set('x-test-role', 'OWNER');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('GET /api/dashboard/today — recorte por papel no servidor', () => {
  for (const role of ['AGENT', 'READONLY', 'SUPERVISOR', 'ADMIN', 'OWNER'] as const) {
    it(`${role}: a carga recebe o papel da SESSÃO (o recorte é resolvido nela)`, async () => {
      const res = await request(app())
        .get('/api/dashboard/today?role=OWNER')
        .set('x-test-role', role);
      expect(res.status).toBe(200);
      expect(h.todayCalls).toEqual([
        { workspaceId: 'ws-home', viewer: { memberId: MEMBER_ID, role } },
      ]);
      const personal = role === 'AGENT' || role === 'READONLY';
      expect(res.body.month === null).toBe(personal);
    });
  }

  it('papel fora da matriz é 403', async () => {
    const res = await request(app()).get('/api/dashboard/today').set('x-test-role', 'ROOT');
    expect(res.status).toBe(403);
    expect(h.todayCalls).toHaveLength(0);
  });

  it('resposta não vai para cache compartilhado', async () => {
    const res = await request(app()).get('/api/dashboard/today').set('x-test-role', 'OWNER');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('GET /api/dashboard/me e /metrics/:key — papel validado e sem cache', () => {
  it('/me passa o papel validado e responde private, no-store', async () => {
    const res = await request(app()).get('/api/dashboard/me').set('x-test-role', 'SUPERVISOR');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(h.meCalls).toEqual([expect.objectContaining({ role: 'SUPERVISOR', memberId: MEMBER_ID })]);
  });

  it('/me com papel fora da matriz é 403 (fail-closed), sem carregar nada', async () => {
    const res = await request(app()).get('/api/dashboard/me').set('x-test-role', 'ROOT');
    expect(res.status).toBe(403);
    expect(h.meCalls).toHaveLength(0);
  });

  it('/metrics/:key passa o papel validado e responde private, no-store', async () => {
    const res = await request(app())
      .get('/api/dashboard/metrics/leads_novos')
      .set('x-test-role', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(h.drillCalls).toEqual([
      expect.objectContaining({ role: 'ADMIN', metricKey: 'leads_novos' }),
    ]);
  });

  it('/metrics/:key com papel fora da matriz é 403 (fail-closed), sem carregar nada', async () => {
    const res = await request(app())
      .get('/api/dashboard/metrics/leads_novos')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
    expect(h.drillCalls).toHaveLength(0);
  });
});
