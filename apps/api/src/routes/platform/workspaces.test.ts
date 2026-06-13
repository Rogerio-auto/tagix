/**
 * F26-S02 -- Tenants list + Workspace 360 (infra dev real, seed deterministico).
 *
 * - Gate (401/403).
 * - list pagina/filtra e traz agregados (membros, custo-mes).
 * - 360 agrega membros/canais/agentes/saude e NUNCA serializa secret/token de canal.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformWorkspacesRouter } from './workspaces';

const { workspaces, members, channels, channelSecrets, agents, llmUsageLogs } = schema;

let wsA = '';
let wsB = '';
let adminCookie = '';
let userCookie = '';
const sfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createPlatformWorkspacesRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const adminReq = (p: string) => request(app).get(p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const [a] = await db
    .insert(workspaces)
    .values({ name: `Tenant Alpha ${sfx}`, slug: `tn-alpha-${sfx}` })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `Tenant Beta ${sfx}`, slug: `tn-beta-${sfx}` })
    .returning();
  wsA = a!.id;
  wsB = b!.id;

  const aAuth = randomUUID();
  const aEmail = `tadmin-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: wsA,
    authUserId: aAuth,
    email: aEmail,
    name: 'Owner Alpha',
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
  });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `tuser-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: wsA, authUserId: uAuth, email: uEmail, role: 'AGENT', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);

  // Canal (token sensivel vive em channel_secrets; o 360 expoe so metadados).
  const [chA] = await db
    .insert(channels)
    .values({
      workspaceId: wsA,
      provider: 'meta_whatsapp',
      name: `WA Alpha ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  await db
    .insert(channelSecrets)
    .values({ channelId: chA!.id, accessTokenEnc: 'SUPER_SECRET_TOKEN_ENC' });

  await db
    .insert(agents)
    .values({ workspaceId: wsA, name: `Bot Alpha ${sfx}`, systemPrompt: 'oi' });

  // Custo de producao + de teste (is_test deve ficar fora do rollup).
  await db.insert(llmUsageLogs).values([
    { workspaceId: wsA, requestType: 'chat', model: 'm/x', totalTokens: 100, costUsd: '12.00000000' },
    { workspaceId: wsA, requestType: 'chat', model: 'm/x', totalTokens: 50, costUsd: '99.00000000', isTest: true },
  ]);
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('gate', () => {
  it('sem sessao -> 401', async () => {
    expect((await request(app).get('/api/platform/tenants')).status).toBe(401);
  });
  it('nao-admin -> 403', async () => {
    expect(
      (await request(app).get('/api/platform/tenants').set('Cookie', userCookie)).status,
    ).toBe(403);
  });
});

describe('list', () => {
  it('busca por nome retorna o tenant e agregados', async () => {
    const res = await adminReq(`/api/platform/tenants?search=alpha-${sfx}`);
    expect(res.status).toBe(200);
    const t = res.body.tenants.find((x: { id: string }) => x.id === wsA);
    expect(t).toBeDefined();
    expect(t.memberCount).toBe(2);
    // Custo de producao = 12; o is_test (99) NAO entra.
    expect(t.monthCostUsd).toBeCloseTo(12, 2);
  });

  it('filtro por status invalido -> 400', async () => {
    expect((await adminReq('/api/platform/tenants?status=bogus')).status).toBe(400);
  });

  it('paginacao: limit=1 retorna no maximo 1', async () => {
    const res = await adminReq('/api/platform/tenants?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.tenants.length).toBeLessThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });
});

describe('workspace 360', () => {
  it('agrega resumo/uso/membros/canais/agentes/saude', async () => {
    const res = await adminReq(`/api/platform/tenants/${wsA}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.id).toBe(wsA);
    expect(res.body.summary.owner.email).toContain('tadmin-');
    expect(res.body.usage.monthCostUsd).toBeCloseTo(12, 2);
    expect(res.body.members.length).toBe(2);
    expect(res.body.channels.length).toBe(1);
    expect(res.body.agents.length).toBe(1);
    expect(res.body.health).toHaveProperty('openConversations');
  });

  it('NUNCA serializa secret/token de canal (so metadados)', async () => {
    const res = await adminReq(`/api/platform/tenants/${wsA}`);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('SUPER_SECRET_TOKEN_ENC');
    expect(blob.toLowerCase()).not.toContain('accesstoken');
    expect(blob.toLowerCase()).not.toContain('token_enc');
    // O canal aparece, mas so com metadados.
    expect(res.body.channels[0]).toHaveProperty('provider');
    expect(res.body.channels[0]).not.toHaveProperty('accessTokenEnc');
  });

  it('id inexistente -> 404', async () => {
    const res = await adminReq(`/api/platform/tenants/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it('id invalido -> 400', async () => {
    expect((await adminReq('/api/platform/tenants/not-a-uuid')).status).toBe(400);
  });
});
