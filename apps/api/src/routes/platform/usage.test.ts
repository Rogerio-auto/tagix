/**
 * F25-S05 — rollup de custo LLM (infra dev real, seed determinístico).
 *
 * - Gate (401/403).
 * - summary agrega por workspace/model/day.
 * - top-spenders ordena por gasto-mês.
 * - cap-alerts cruza com policy.max_monthly_cost_usd (workspace acima do threshold).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformUsageRouter } from './usage';

const { workspaces, members, llmUsageLogs, workspaceAgentPolicies } = schema;

let wsA = '';
let wsB = '';
let adminCookie = '';
let userCookie = '';
const MODEL_X = `usage-vendor/x-${randomUUID().slice(0, 6)}`;
const MODEL_Y = `usage-vendor/y-${randomUUID().slice(0, 6)}`;

const app = express();
app.use(express.json());
app.use(createPlatformUsageRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const adminReq = (p: string) => request(app).get(p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [a] = await db.insert(workspaces).values({ name: `UA ${sfx}`, slug: `ua-${sfx}` }).returning();
  const [b] = await db.insert(workspaces).values({ name: `UB ${sfx}`, slug: `ub-${sfx}` }).returning();
  wsA = a!.id;
  wsB = b!.id;

  const aAuth = randomUUID();
  const aEmail = `uadmin-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsA, authUserId: aAuth, email: aEmail, role: 'OWNER', status: 'active', isPlatformAdmin: true });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `uuser-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsA, authUserId: uAuth, email: uEmail, role: 'OWNER', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);

  // Seed determinístico: wsA gasta 30, wsB gasta 5 (mês corrente).
  await db.insert(llmUsageLogs).values([
    { workspaceId: wsA, requestType: 'chat', model: MODEL_X, totalTokens: 1000, costUsd: '20.00000000' },
    { workspaceId: wsA, requestType: 'chat', model: MODEL_Y, totalTokens: 500, costUsd: '10.00000000' },
    { workspaceId: wsB, requestType: 'chat', model: MODEL_X, totalTokens: 200, costUsd: '5.00000000' },
  ]);

  // Cap em wsA: 25 USD → gasto 30 ⇒ 120% (alerta). wsB sem cap.
  await db.insert(workspaceAgentPolicies).values({ workspaceId: wsA, maxMonthlyCostUsd: '25.00' });
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/platform/usage/summary?groupBy=model')).status).toBe(401);
  });
  it('não-admin → 403', async () => {
    expect((await request(app).get('/api/platform/usage/summary?groupBy=model').set('Cookie', userCookie)).status).toBe(403);
  });
});

describe('summary', () => {
  it('groupBy=model agrega custo por modelo', async () => {
    const res = await adminReq('/api/platform/usage/summary?groupBy=model');
    expect(res.status).toBe(200);
    const x = res.body.buckets.find((bk: { key: string }) => bk.key === MODEL_X);
    expect(x.costUsd).toBeCloseTo(25, 2); // 20 (wsA) + 5 (wsB)
    expect(x.requests).toBe(2);
  });

  it('groupBy=workspace agrega custo por workspace', async () => {
    const res = await adminReq('/api/platform/usage/summary?groupBy=workspace');
    const a = res.body.buckets.find((bk: { key: string }) => bk.key === wsA);
    expect(a.costUsd).toBeCloseTo(30, 2);
    expect(a.label).toContain('UA');
  });

  it('groupBy inválido → 400', async () => {
    expect((await adminReq('/api/platform/usage/summary?groupBy=bogus')).status).toBe(400);
  });
});

describe('top-spenders', () => {
  it('ordena por gasto-mês (wsA antes de wsB)', async () => {
    const res = await adminReq('/api/platform/usage/top-spenders?period=month');
    expect(res.status).toBe(200);
    const ids = res.body.spenders.map((s: { workspaceId: string }) => s.workspaceId);
    expect(ids.indexOf(wsA)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(wsA)).toBeLessThan(ids.indexOf(wsB) === -1 ? Infinity : ids.indexOf(wsB));
    const a = res.body.spenders.find((s: { workspaceId: string }) => s.workspaceId === wsA);
    expect(a.costUsd).toBeCloseTo(30, 2);
  });
});

describe('cap-alerts', () => {
  it('lista wsA acima do threshold (gasto 30 ≥ 80% de 25)', async () => {
    const res = await adminReq('/api/platform/usage/cap-alerts');
    expect(res.status).toBe(200);
    const alert = res.body.alerts.find((al: { workspaceId: string }) => al.workspaceId === wsA);
    expect(alert).toBeDefined();
    expect(alert.capUsd).toBeCloseTo(25, 2);
    expect(alert.monthCostUsd).toBeCloseTo(30, 2);
    expect(alert.pctOfCap).toBeGreaterThan(1);
    // wsB não tem cap → não aparece.
    expect(res.body.alerts.find((al: { workspaceId: string }) => al.workspaceId === wsB)).toBeUndefined();
  });
});
