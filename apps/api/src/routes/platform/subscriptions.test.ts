/**
 * F26-S04 -- Subscriptions + resolveEntitlements (infra dev real).
 * Gate, troca de plano/status/trial/cycle, override (custom plan), merge efetivo
 * (override > plano), transicoes de status, sem Stripe.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformSubscriptionsRouter } from './subscriptions';

const { workspaces, members, plans, subscriptions } = schema;

let wsA = '';
let planBasicId = '';
let planProId = '';
let adminCookie = '';
let userCookie = '';
const sfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createPlatformSubscriptionsRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;

beforeAll(async () => {
  const db = getDb();
  const [basic] = await db
    .insert(plans)
    .values({
      key: `f26-sub-${sfx}-basic`,
      name: 'Basic',
      limits: { max_agents: 2, max_channels: 1 },
      features: { instagram: false, api_access: false },
    })
    .returning();
  const [pro] = await db
    .insert(plans)
    .values({
      key: `f26-sub-${sfx}-pro`,
      name: 'Pro',
      limits: { max_agents: 10, max_channels: 5 },
      features: { instagram: true, api_access: true },
    })
    .returning();
  planBasicId = basic!.id;
  planProId = pro!.id;

  const [a] = await db
    .insert(workspaces)
    .values({ name: `SubWS ${sfx}`, slug: `subws-${sfx}`, planId: planBasicId })
    .returning();
  wsA = a!.id;

  const aAuth = randomUUID();
  const aEmail = `sadmin-${sfx}@t.local`;
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
  const uEmail = `suser-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: wsA, authUserId: uAuth, email: uEmail, role: 'AGENT', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(subscriptions).where(eq(subscriptions.workspaceId, wsA));
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  await db.delete(plans).where(like(plans.key, `f26-sub-${sfx}%`));
  await closeDb();
});

describe('gate', () => {
  it('sem sessao -> 401', async () => {
    expect((await request(app).get(`/api/platform/tenants/${wsA}/subscription`)).status).toBe(401);
  });
  it('nao-admin -> 403', async () => {
    expect(
      (
        await request(app)
          .get(`/api/platform/tenants/${wsA}/subscription`)
          .set('Cookie', userCookie)
      ).status,
    ).toBe(403);
  });
});

describe('GET subscription + resolveEntitlements', () => {
  it('retorna plano basic e entitlements do plano (sem override)', async () => {
    const res = await request(app)
      .get(`/api/platform/tenants/${wsA}/subscription`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.planId).toBe(planBasicId);
    expect(res.body.entitlements.limits.max_agents).toBe(2);
    expect(res.body.entitlements.features.instagram).toBe(false);
    expect(res.body.entitlements.overrideLimits).toEqual({});
  });

  it('workspace inexistente -> 404', async () => {
    const res = await request(app)
      .get(`/api/platform/tenants/${randomUUID()}/subscription`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

describe('PUT subscription', () => {
  it('troca para o plano Pro e reflete nos entitlements', async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/subscription`)
      .set('Cookie', adminCookie)
      .send({ planId: planProId, status: 'active', billingCycle: 'yearly' });
    expect(res.status).toBe(200);
    expect(res.body.planId).toBe(planProId);
    expect(res.body.status).toBe('active');
    expect(res.body.entitlements.limits.max_agents).toBe(10);
    expect(res.body.entitlements.features.instagram).toBe(true);
  });

  it('cria/atualiza a linha em subscriptions', async () => {
    const db = getDb();
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, wsA));
    expect(sub).toBeDefined();
    expect(sub!.planId).toBe(planProId);
    expect(sub!.billingCycle).toBe('yearly');
  });

  it('estende o trial (trialEndsAt editavel)', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/subscription`)
      .set('Cookie', adminCookie)
      .send({ status: 'trial', trialEndsAt: future });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('trial');
    expect(new Date(res.body.trialEndsAt).getTime()).toBeCloseTo(new Date(future).getTime(), -3);
  });

  it('status invalido -> 400', async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/subscription`)
      .set('Cookie', adminCookie)
      .send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('plano inexistente -> 400', async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/subscription`)
      .set('Cookie', adminCookie)
      .send({ planId: randomUUID() });
    expect(res.status).toBe(400);
  });

  it('body vazio -> 400', async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/subscription`)
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('PUT entitlement-overrides (custom plan)', () => {
  it('override VENCE o plano no merge efetivo', async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/entitlement-overrides`)
      .set('Cookie', adminCookie)
      .send({ limits: { max_agents: 99 }, features: { api_access: false } });
    expect(res.status).toBe(200);
    // Plano Pro da max_agents=10/api_access=true; override sobrepoe.
    expect(res.body.entitlements.limits.max_agents).toBe(99);
    expect(res.body.entitlements.features.api_access).toBe(false);
    // O que nao foi sobreposto continua do plano.
    expect(res.body.entitlements.limits.max_channels).toBe(5);
    expect(res.body.entitlements.features.instagram).toBe(true);
    // Mostra a origem.
    expect(res.body.entitlements.overrideLimits.max_agents).toBe(99);
    expect(res.body.entitlements.planLimits.max_agents).toBe(10);
  });

  it('rejeita chave de limit desconhecida -> 400', async () => {
    const res = await request(app)
      .put(`/api/platform/tenants/${wsA}/entitlement-overrides`)
      .set('Cookie', adminCookie)
      .send({ limits: { bogus: 1 } });
    expect(res.status).toBe(400);
  });
});
