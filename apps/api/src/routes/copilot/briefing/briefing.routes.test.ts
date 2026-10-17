/**
 * F73-S12 · API do briefing com a MESMA porta de produção (`requireAuth → withRLS →
 * copilotAvailable`) sobre o Postgres e o Redis de dev, com relógio fixo.
 */
import { eq } from 'drizzle-orm';
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, copilotMemberPrefsRepo, getDb, schema, withWorkspace } from '@hm/db';
import { BriefingSchema, type Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../../middlewares/auth';
import { closeRateLimit } from '../../../middlewares/rate-limit';
import { copilotAvailable } from '../../../services/copilot/identity/available';
import {
  BRIEFING_DATE,
  BRIEFING_NOW,
  seedBriefingWorld,
  type BriefingWorld,
} from '../../../services/copilot/briefing/test-fixtures';
import { createCopilotBriefingRouter } from './index';

let world: BriefingWorld;
let disabled: BriefingWorld;
let app: Express;

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  const router = Router();
  router.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
  router.use(createCopilotBriefingRouter({ now: () => BRIEFING_NOW }));
  a.use(router);
  return a;
}

const cookie = (role: Role): string => world.ws.members[role].cookie;
const norm = (text: string): string => text.replace(/\u00a0/g, ' ');

beforeAll(async () => {
  world = await seedBriefingWorld({ label: 'BriefingApi' });
  disabled = await seedBriefingWorld({ label: 'BriefingApiOff', empty: true });
  await withWorkspace(disabled.workspaceId, (tx) =>
    tx.insert(schema.copilotSettings).values({ workspaceId: disabled.workspaceId, enabled: false }),
  );
  app = buildApp();
});

afterAll(async () => {
  await world?.cleanup();
  await disabled?.cleanup();
  await closeRateLimit();
  await closeDb();
});

describe('GET /api/copilot/briefing/today', () => {
  it('sem sessão: 401', async () => {
    const res = await request(app).get('/api/copilot/briefing/today');
    expect(res.status).toBe(401);
  });

  it('OWNER: devolve o Briefing do contrato (≤ 3 itens, sem cache) e é estável na 2ª chamada', async () => {
    const res = await request(app)
      .get('/api/copilot/briefing/today')
      .set('Cookie', cookie('OWNER'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const briefing = BriefingSchema.parse(res.body);
    expect(briefing.for_date).toBe(BRIEFING_DATE);
    expect(briefing.items).toHaveLength(3);
    expect(briefing.overflow_count).toBe(3);
    expect(briefing.items.map((i) => i.kind)).toEqual([
      'deals_idle',
      'events_today',
      'leads_waiting',
    ]);
    expect(norm(briefing.items[0]?.title ?? '')).toContain('R$ 35.000 em Orçamento enviado');
    expect(JSON.stringify(res.body)).not.toContain('_meta');

    const again = await request(app)
      .get('/api/copilot/briefing/today')
      .set('Cookie', cookie('OWNER'));
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(briefing.id);
    expect(again.body.generated_at).toBe(briefing.generated_at);
  });

  it('AGENT: só o que é dele (R$ 15.000 parados, não os R$ 35.000 do time)', async () => {
    const res = await request(app)
      .get('/api/copilot/briefing/today')
      .set('Cookie', cookie('AGENT'));
    expect(res.status).toBe(200);
    const briefing = BriefingSchema.parse(res.body);
    const idle = briefing.items.find((i) => i.kind === 'deals_idle');
    expect(idle?.value_at_risk).toBe(15_000);
    expect(briefing.items.some((i) => i.kind === 'campaign_issue')).toBe(false);
  });

  it('READONLY e SUPERVISOR também leem (copilot.use é de todos os papéis)', async () => {
    for (const role of ['READONLY', 'SUPERVISOR'] as const) {
      const res = await request(app)
        .get('/api/copilot/briefing/today')
        .set('Cookie', cookie(role));
      expect(res.status).toBe(200);
      BriefingSchema.parse(res.body);
    }
  });

  it('Copiloto desligado na empresa: 403 copilot_disabled (a porta de sempre)', async () => {
    const res = await request(app)
      .get('/api/copilot/briefing/today')
      .set('Cookie', disabled.ws.members.OWNER.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('copilot_disabled');
  });
});

describe('POST /api/copilot/briefing/today/seen', () => {
  it('sem briefing de hoje: 404 (nada para marcar)', async () => {
    const res = await request(app)
      .post('/api/copilot/briefing/today/seen')
      .set('Cookie', cookie('ADMIN'));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('briefing_not_found');
  });

  it('marca seen_at e briefing_last_seen_on; é idempotente (o 1º instante fica)', async () => {
    await request(app).get('/api/copilot/briefing/today').set('Cookie', cookie('ADMIN'));
    const first = await request(app)
      .post('/api/copilot/briefing/today/seen')
      .set('Cookie', cookie('ADMIN'));
    expect(first.status).toBe(200);
    expect(first.body.for_date).toBe(BRIEFING_DATE);
    expect(typeof first.body.seen_at).toBe('string');

    const second = await request(app)
      .post('/api/copilot/briefing/today/seen')
      .set('Cookie', cookie('ADMIN'));
    expect(second.status).toBe(200);
    expect(second.body.seen_at).toBe(first.body.seen_at);

    const prefs = await withWorkspace(world.workspaceId, (tx) =>
      copilotMemberPrefsRepo.get(tx, world.workspaceId, world.member('ADMIN')),
    );
    expect(prefs.briefingLastSeenOn).toBe(BRIEFING_DATE);

    const get = await request(app).get('/api/copilot/briefing/today').set('Cookie', cookie('ADMIN'));
    expect(get.body.seen_at).toBe(first.body.seen_at);
  });

  it('marcar como visto não afeta o briefing de outro membro', async () => {
    const rows = await getDb()
      .select({ memberId: schema.copilotBriefings.memberId, seenAt: schema.copilotBriefings.seenAt })
      .from(schema.copilotBriefings)
      .where(eq(schema.copilotBriefings.workspaceId, world.workspaceId));
    const seen = rows.filter((r) => r.seenAt !== null).map((r) => r.memberId);
    expect(seen).toEqual([world.member('ADMIN')]);
  });
});
