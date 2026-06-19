/**
 * Uso/custo LLM do WORKSPACE (tenant-scoped via RLS). Infra dev real, seed
 * determinístico. Cobre:
 *  - Gate (401 sem sessão, 403 sem `agent.view_costs`).
 *  - Isolamento RLS: o workspace só enxerga o próprio gasto (não vaza wsB).
 *  - `is_test=true` excluído (gasto de playground não é billing real).
 *  - summary groupBy=model e totals (hoje/mês).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../auth/session';
import { createUsageRouter } from './usage';

const { workspaces, members, llmUsageLogs } = schema;

let wsA = '';
let wsB = '';
let ownerCookie = '';
let agentCookie = '';
const MODEL_X = `wsusage-vendor/x-${randomUUID().slice(0, 6)}`;
const MODEL_Y = `wsusage-vendor/y-${randomUUID().slice(0, 6)}`;

const app = express();
app.use(express.json());
app.use(createUsageRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const ownerGet = (p: string) => request(app).get(p).set('Cookie', ownerCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [a] = await db.insert(workspaces).values({ name: `WA ${sfx}`, slug: `wa-${sfx}` }).returning();
  const [b] = await db.insert(workspaces).values({ name: `WB ${sfx}`, slug: `wb-${sfx}` }).returning();
  wsA = a!.id;
  wsB = b!.id;

  const oAuth = randomUUID();
  const oEmail = `wowner-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsA, authUserId: oAuth, email: oEmail, role: 'OWNER', status: 'active' });
  ownerCookie = cookieFor(oAuth, oEmail);

  const gAuth = randomUUID();
  const gEmail = `wagent-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsA, authUserId: gAuth, email: gEmail, role: 'AGENT', status: 'active' });
  agentCookie = cookieFor(gAuth, gEmail);

  // wsA: 30 USD reais (X=20, Y=10) + 99 USD de teste (excluído). wsB: 5 USD (não vaza).
  await db.insert(llmUsageLogs).values([
    { workspaceId: wsA, requestType: 'chat', model: MODEL_X, totalTokens: 1000, costUsd: '20.00000000' },
    { workspaceId: wsA, requestType: 'chat', model: MODEL_Y, totalTokens: 500, costUsd: '10.00000000' },
    { workspaceId: wsA, requestType: 'chat', model: MODEL_X, totalTokens: 999, costUsd: '99.00000000', isTest: true },
    { workspaceId: wsB, requestType: 'chat', model: MODEL_X, totalTokens: 200, costUsd: '5.00000000' },
  ]);
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/usage/totals')).status).toBe(401);
  });
  it('role sem agent.view_costs (AGENT) → 403', async () => {
    expect((await request(app).get('/api/usage/totals').set('Cookie', agentCookie)).status).toBe(403);
  });
});

describe('totals', () => {
  it('soma só o gasto real do próprio workspace (exclui is_test e wsB)', async () => {
    const res = await ownerGet('/api/usage/totals');
    expect(res.status).toBe(200);
    // 20 + 10 = 30 (o 99 é is_test; o 5 é wsB → RLS não enxerga).
    expect(res.body.month.costUsd).toBeCloseTo(30, 2);
    expect(res.body.today.costUsd).toBeCloseTo(30, 2);
    expect(res.body.month.requests).toBe(2);
  });
});

describe('summary', () => {
  it('groupBy=model agrega por modelo, sem dados de outro workspace', async () => {
    const res = await ownerGet('/api/usage/summary?groupBy=model');
    expect(res.status).toBe(200);
    const x = res.body.buckets.find((bk: { key: string }) => bk.key === MODEL_X);
    expect(x.costUsd).toBeCloseTo(20, 2); // só wsA real; wsB (5) isolado por RLS
    expect(x.requests).toBe(1);
  });

  it('groupBy inválido → 400', async () => {
    expect((await ownerGet('/api/usage/summary?groupBy=bogus')).status).toBe(400);
  });
});
