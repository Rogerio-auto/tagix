/**
 * F73-S15 · `/api/copilot/usage` e `/api/copilot/insights` contra o Postgres de dev, com a MESMA
 * porta de produção (`requireAuth → withRLS → copilotAvailable`) e o mundo semeado de
 * `services/copilot/usage/test-fixtures.ts` (todos os números abaixo são conta feita à mão
 * a partir dele).
 */
import { eq } from 'drizzle-orm';
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { CopilotUsageSchema, type Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../../middlewares/auth';
import { closeRateLimit } from '../../../middlewares/rate-limit';
import { copilotAvailable } from '../../../services/copilot/identity/available';
import { CopilotInsightsSchema } from '../../../services/copilot/usage';
import {
  seedUsageWorld,
  USAGE_NOW,
  type UsageWorld,
} from '../../../services/copilot/usage/test-fixtures';
import { createCopilotRouter } from '../index';
import { createCopilotUsageRouter } from './index';

let world: UsageWorld;
let app: Express;

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  const router = Router();
  router.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
  router.use(createCopilotUsageRouter({ now: () => USAGE_NOW }));
  a.use(router);
  return a;
}

beforeAll(async () => {
  world = await seedUsageWorld();
  app = buildApp();
});

afterAll(async () => {
  await world?.cleanup();
  await closeRateLimit();
  await closeDb();
});

const cookie = (role: Role): string => world.members[role].cookie;

describe('GET /api/copilot/usage', () => {
  it.each(['AGENT', 'SUPERVISOR', 'READONLY'] as const)('%s recebe 403', async (role) => {
    const res = await request(app).get('/api/copilot/usage').set('Cookie', cookie(role));
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('spent_usd');
  });

  it('sem sessão: 401', async () => {
    expect((await request(app).get('/api/copilot/usage')).status).toBe(401);
  });

  it('OWNER e ADMIN leem o contrato com os números do seed', async () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const res = await request(app).get('/api/copilot/usage').set('Cookie', cookie(role));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const usage = CopilotUsageSchema.parse(res.body);

      // Mês de outubro (UTC): 0,50 + 1,25 + 0,75; a linha `agent` (5,00) e setembro (9,00) fora.
      expect(usage).toMatchObject({
        month: '2026-10',
        resets_on: '2026-11-01',
        spent_usd: 2.5,
        cap_usd: 30,
        pct: 8.33,
        budget_mode: 'queries_only',
        state: 'ok',
        turns: 4,
      });
      expect(usage.top_members).toEqual([
        {
          member_id: world.members.ADMIN.id,
          name: expect.stringContaining('ADMIN'),
          cost_usd: 1.75,
          turns: 2,
        },
        {
          member_id: world.members.OWNER.id,
          name: expect.stringContaining('OWNER'),
          cost_usd: 0.75,
          turns: 2,
        },
      ]);
      expect(usage.actions_by_risk).toEqual([
        { risk_level: 2, count: 1 },
        // P2, P3, P4, P5, P6 e os dois do piloto; a nível 4 `blocked` não conta.
        { risk_level: 3, count: 7 },
      ]);
      expect(usage.daily).toHaveLength(17);
      expect(usage.daily[0]).toEqual({ date: '2026-10-01', cost_usd: 0, turns: 0 });
      expect(usage.daily.find((d) => d.date === '2026-10-03')).toEqual({
        date: '2026-10-03',
        cost_usd: 0.5,
        turns: 1,
      });
      expect(usage.daily.find((d) => d.date === '2026-10-10')).toEqual({
        date: '2026-10-10',
        cost_usd: 1.25,
        turns: 1,
      });
      expect(usage.daily.at(-1)).toEqual({ date: '2026-10-17', cost_usd: 0.75, turns: 2 });
      // A soma da série é o gasto do mês.
      expect(usage.daily.reduce((s, d) => s + d.cost_usd, 0)).toBeCloseTo(usage.spent_usd, 6);
    }
  });

  it('o estado acompanha a régua do orçamento (teto de US$ 3 → alerta; US$ 2 → queries_only)', async () => {
    const db = getDb();
    await db
      .insert(schema.copilotSettings)
      .values({ workspaceId: world.workspaceId, monthlyBudgetUsd: '3.00', budgetAlertPct: 80 })
      .onConflictDoUpdate({
        target: schema.copilotSettings.workspaceId,
        set: { monthlyBudgetUsd: '3.00', budgetAlertPct: 80 },
      });
    const alert = await request(app).get('/api/copilot/usage').set('Cookie', cookie('OWNER'));
    expect(alert.body).toMatchObject({ cap_usd: 3, pct: 83.33, state: 'alert' });

    await db
      .update(schema.copilotSettings)
      .set({ monthlyBudgetUsd: '2.00' })
      .where(eq(schema.copilotSettings.workspaceId, world.workspaceId));
    const over = await request(app).get('/api/copilot/usage').set('Cookie', cookie('OWNER'));
    expect(over.body).toMatchObject({ cap_usd: 2, pct: 125, state: 'paused' });

    await db
      .update(schema.copilotSettings)
      .set({ monthlyBudgetUsd: '2.40' })
      .where(eq(schema.copilotSettings.workspaceId, world.workspaceId));
    const queries = await request(app).get('/api/copilot/usage').set('Cookie', cookie('OWNER'));
    expect(queries.body).toMatchObject({ cap_usd: 2.4, state: 'queries_only' });

    await db
      .delete(schema.copilotSettings)
      .where(eq(schema.copilotSettings.workspaceId, world.workspaceId));
  });

  it('o router real (`createCopilotRouter`) monta /usage com a mesma permissão', async () => {
    const real = express();
    real.use(express.json());
    real.use(createCopilotRouter());
    const ok = await request(real).get('/api/copilot/usage').set('Cookie', cookie('OWNER'));
    expect(ok.status).toBe(200);
    expect(CopilotUsageSchema.safeParse(ok.body).success).toBe(true);
    const denied = await request(real)
      .get('/api/copilot/usage')
      .set('Cookie', cookie('SUPERVISOR'));
    expect(denied.status).toBe(403);
  });

  it('o payload não vaza conteúdo: só valores, contagens e nomes de membros', async () => {
    const res = await request(app).get('/api/copilot/usage').set('Cookie', cookie('OWNER'));
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@t.local');
    expect(text).not.toContain('Mover negócios');
  });
});

describe('GET /api/copilot/insights', () => {
  it.each(['AGENT', 'SUPERVISOR', 'READONLY'] as const)('%s recebe 403', async (role) => {
    const res = await request(app).get('/api/copilot/insights').set('Cookie', cookie(role));
    expect(res.status).toBe(403);
  });

  it('ADMIN lê as métricas de produto do seed', async () => {
    const res = await request(app).get('/api/copilot/insights').set('Cookie', cookie('ADMIN'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const insights = CopilotInsightsSchema.parse(res.body);

    // Semana (a partir de 10-10 12:00Z): só o OWNER (T3, T4); 1 de 5 membros elegíveis.
    expect(insights.members).toEqual({ eligible: 5, weekly_active: 1, weekly_active_rate: 0.2 });
    // Nível 3 do Copiloto: confirmadas P2 e P3; cancelada P4; expirada P5.
    expect(insights.level3).toEqual({ confirmed: 2, cancelled: 1, expired: 1, confirm_rate: 0.5 });
    // Executadas P1, P2, P3, P8, P9; desfeitas P3 e P9; piloto: P8 e P9, uma desfeita.
    expect(insights.undo).toEqual({
      executed: 5,
      undone: 2,
      undo_rate: 0.4,
      autopilot_executed: 2,
      autopilot_undone: 1,
      autopilot_undo_rate: 0.5,
    });
    // A aprovada há 40 dias, a pendente e a expirada ficam de fora.
    expect(insights.pilot).toEqual({
      accepted: 2,
      decided: 4,
      accept_rate: 0.5,
      stages: [
        {
          stage_id: world.stageA,
          stage_name: 'Estágio A',
          accepted: 2,
          decided: 3,
          accept_rate: 0.6667,
        },
        {
          stage_id: world.stageB,
          stage_name: 'Estágio B',
          accepted: 0,
          decided: 1,
          accept_rate: 0,
        },
      ],
    });
    // Visto no próprio dia (fuso SP): só o de 10-15; o de 10-16 foi visto no dia seguinte.
    expect(insights.briefing).toEqual({ ready: 3, seen_same_day: 1, seen_rate: 0.3333 });
    // Concluídos em 30 dias: T1, T2, T3, T5; um com format_fallback.
    expect(insights.turns).toEqual({
      completed: 4,
      format_fallback: 1,
      format_fallback_rate: 0.25,
    });
  });

  it('não devolve texto de conversa nem de negócio', async () => {
    const res = await request(app).get('/api/copilot/insights').set('Cookie', cookie('OWNER'));
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Parado há 10 dias');
    expect(text).not.toContain('Cliente Teste');
  });
});
