/**
 * F26-S03 -- Plans CRUD (infra dev real). Gate, CRUD, limits/features tipados,
 * soft-delete, sem chamada Stripe.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformPlansRouter } from './plans';

const { workspaces, members, plans } = schema;

let wsA = '';
let adminCookie = '';
let userCookie = '';
const sfx = randomUUID().slice(0, 8);
const keyPrefix = `f26-plan-${sfx}`;

const app = express();
app.use(express.json());
app.use(createPlatformPlansRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;

beforeAll(async () => {
  const db = getDb();
  const [a] = await db
    .insert(workspaces)
    .values({ name: `PlanWS ${sfx}`, slug: `planws-${sfx}` })
    .returning();
  wsA = a!.id;

  const aAuth = randomUUID();
  const aEmail = `padmin-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: wsA,
    authUserId: aAuth,
    email: aEmail,
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
  });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `puser-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: wsA, authUserId: uAuth, email: uEmail, role: 'AGENT', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  await db.delete(plans).where(like(plans.key, `${keyPrefix}%`));
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  await closeDb();
});

describe('gate', () => {
  it('sem sessao -> 401', async () => {
    expect((await request(app).get('/api/platform/plans')).status).toBe(401);
  });
  it('nao-admin -> 403', async () => {
    expect(
      (await request(app).get('/api/platform/plans').set('Cookie', userCookie)).status,
    ).toBe(403);
  });
});

describe('CRUD', () => {
  let planId = '';

  it('POST cria plano com limits/features tipados', async () => {
    const res = await request(app)
      .post('/api/platform/plans')
      .set('Cookie', adminCookie)
      .send({
        key: `${keyPrefix}-pro`,
        name: 'Pro',
        priceMonthlyCents: 9900,
        limits: { max_agents: 10, max_channels: 5 },
        features: { instagram: true, api_access: true },
        position: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.plan.limits.max_agents).toBe(10);
    expect(res.body.plan.features.instagram).toBe(true);
    expect(res.body.plan.isActive).toBe(true);
    planId = res.body.plan.id;
  });

  it('POST rejeita chave de limit desconhecida -> 400', async () => {
    const res = await request(app)
      .post('/api/platform/plans')
      .set('Cookie', adminCookie)
      .send({ key: `${keyPrefix}-bad`, name: 'Bad', limits: { bogus_limit: 5 } });
    expect(res.status).toBe(400);
  });

  it('POST rejeita feature nao-booleana -> 400', async () => {
    const res = await request(app)
      .post('/api/platform/plans')
      .set('Cookie', adminCookie)
      .send({ key: `${keyPrefix}-bad2`, name: 'Bad2', features: { instagram: 'yes' } });
    expect(res.status).toBe(400);
  });

  it('POST com key duplicada -> 409', async () => {
    const res = await request(app)
      .post('/api/platform/plans')
      .set('Cookie', adminCookie)
      .send({ key: `${keyPrefix}-pro`, name: 'Dup' });
    expect(res.status).toBe(409);
  });

  it('GET lista inclui o plano criado', async () => {
    const res = await request(app).get('/api/platform/plans').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.plans.some((p: { id: string }) => p.id === planId)).toBe(true);
  });

  it('PATCH edita preco e limits', async () => {
    const res = await request(app)
      .patch(`/api/platform/plans/${planId}`)
      .set('Cookie', adminCookie)
      .send({ priceMonthlyCents: 12900, limits: { max_agents: 20 } });
    expect(res.status).toBe(200);
    expect(res.body.plan.priceMonthlyCents).toBe(12900);
    expect(res.body.plan.limits.max_agents).toBe(20);
  });

  it('DELETE faz soft-delete (is_active=false), nao remove', async () => {
    const res = await request(app)
      .delete(`/api/platform/plans/${planId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.plan.isActive).toBe(false);
    const db = getDb();
    const [row] = await db.select().from(plans).where(eq(plans.id, planId));
    expect(row).toBeDefined();
    expect(row!.isActive).toBe(false);
  });

  it('PATCH em id inexistente -> 404', async () => {
    const res = await request(app)
      .patch(`/api/platform/plans/${randomUUID()}`)
      .set('Cookie', adminCookie)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});
