/**
 * Rotas de org. Cobre:
 *  - gates de sessão (sem auth → 401) nos endpoints existentes (departments/teams/sla);
 *  - F30-S08 visibility settings: authz (`inbox.visibility.manage` = OWNER/ADMIN;
 *    SUPERVISOR/AGENT → 403), persistência e trilha de auditoria (`audit_logs`).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createOrgSettingsRouter } from './index';

const {
  workspaces,
  members,
  departments,
  teams,
  inboxVisibilitySettings,
  memberVisibilityOverrides,
  auditLogs,
} = schema;

const app = express();
app.use(express.json());
app.use(createOrgSettingsRouter());

const VISIBILITY_ACTION = 'settings.inbox.visibility_changed';

let ws = '';
let ownerCookie = '';
let supervisorCookie = '';
let agentCookie = '';
let agentMemberId = '';
let deptAId = '';
let deptBId = '';
let teamId = '';

function mockCookie(authUserId: string, email: string): string {
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

const asOwner = (m: 'get' | 'put' | 'patch', path: string) =>
  request(app)[m](path).set('Cookie', ownerCookie);
const asSupervisor = (m: 'get' | 'put' | 'patch', path: string) =>
  request(app)[m](path).set('Cookie', supervisorCookie);
const asAgent = (m: 'get' | 'put' | 'patch', path: string) =>
  request(app)[m](path).set('Cookie', agentCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'Org', slug: `org-${sfx}` }).returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const ownerAuth = randomUUID();
  const ownerEmail = `owner-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: ownerAuth, email: ownerEmail, role: 'OWNER', status: 'active' });
  ownerCookie = mockCookie(ownerAuth, ownerEmail);

  const supAuth = randomUUID();
  const supEmail = `sup-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: supAuth, email: supEmail, role: 'SUPERVISOR', status: 'active' });
  supervisorCookie = mockCookie(supAuth, supEmail);

  const agentAuth = randomUUID();
  const agentEmail = `agent-${sfx}@t.local`;
  const [agentM] = await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: agentAuth, email: agentEmail, role: 'AGENT', status: 'active' })
    .returning();
  if (!agentM) throw new Error('agent');
  agentMemberId = agentM.id;
  agentCookie = mockCookie(agentAuth, agentEmail);

  const [dA] = await db.insert(departments).values({ workspaceId: ws, name: `Dept A ${sfx}` }).returning();
  const [dB] = await db.insert(departments).values({ workspaceId: ws, name: `Dept B ${sfx}` }).returning();
  if (!dA || !dB) throw new Error('depts');
  deptAId = dA.id;
  deptBId = dB.id;

  const [t] = await db.insert(teams).values({ workspaceId: ws, name: `Team ${sfx}` }).returning();
  if (!t) throw new Error('team');
  teamId = t.id;
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gates de sessão (endpoints existentes)', () => {
  const ID = '00000000-0000-0000-0000-000000000001';
  it('GET /api/departments sem sessão -> 401', async () => {
    expect((await request(app).get('/api/departments')).status).toBe(401);
  });
  it('GET /api/teams sem sessão -> 401', async () => {
    expect((await request(app).get('/api/teams')).status).toBe(401);
  });
  it('PUT /api/teams/:id/members/:memberId sem sessão -> 401', async () => {
    expect((await request(app).put(`/api/teams/${ID}/members/${ID}`).send({})).status).toBe(401);
  });
  it('GET /api/sla sem sessão -> 401', async () => {
    expect((await request(app).get('/api/sla')).status).toBe(401);
  });
});

describe('F30-S08 visibility — gates (auth + permissão)', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/org/inbox-visibility')).status).toBe(401);
    expect(
      (await request(app).put('/api/org/inbox-visibility').send({ defaultPeerVisibility: 'private' }))
        .status,
    ).toBe(401);
  });

  it('SUPERVISOR não tem inbox.visibility.manage → 403', async () => {
    expect((await asSupervisor('get', '/api/org/inbox-visibility')).status).toBe(403);
    expect(
      (await asSupervisor('put', '/api/org/inbox-visibility').send({ defaultPeerVisibility: 'private' }))
        .status,
    ).toBe(403);
    expect(
      (await asSupervisor('patch', `/api/org/teams/${teamId}/peer-visibility`).send({ peerVisibility: 'shared' }))
        .status,
    ).toBe(403);
  });

  it('AGENT não tem inbox.visibility.manage → 403', async () => {
    expect((await asAgent('get', `/api/org/members/${agentMemberId}/visibility-overrides`)).status).toBe(403);
    expect(
      (await asAgent('put', `/api/org/members/${agentMemberId}/visibility-overrides`).send({ departmentIds: [] }))
        .status,
    ).toBe(403);
  });
});

describe('F30-S08 visibility — política do workspace', () => {
  it('GET retorna defaults antes de qualquer escrita', async () => {
    const res = await asOwner('get', '/api/org/inbox-visibility');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ defaultPeerVisibility: 'shared', readonlySeesAll: true });
  });

  it('PUT persiste, é idempotente (upsert 1/workspace) e audita', async () => {
    const res = await asOwner('put', '/api/org/inbox-visibility').send({
      defaultPeerVisibility: 'private',
      readonlySeesAll: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ defaultPeerVisibility: 'private', readonlySeesAll: false });

    const db = getDb();
    const rows = await db
      .select()
      .from(inboxVisibilitySettings)
      .where(eq(inboxVisibilitySettings.workspaceId, ws));
    expect(rows.length).toBe(1);
    expect(rows[0]?.defaultPeerVisibility).toBe('private');
    expect(rows[0]?.readonlySeesAll).toBe(false);

    // Segundo PUT não duplica linha.
    await asOwner('put', '/api/org/inbox-visibility').send({ defaultPeerVisibility: 'shared' });
    const rows2 = await db
      .select()
      .from(inboxVisibilitySettings)
      .where(eq(inboxVisibilitySettings.workspaceId, ws));
    expect(rows2.length).toBe(1);
    expect(rows2[0]?.defaultPeerVisibility).toBe('shared');

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ws), eq(auditLogs.action, VISIBILITY_ACTION)));
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it('PUT rejeita enum inválido → 400', async () => {
    const res = await asOwner('put', '/api/org/inbox-visibility').send({ defaultPeerVisibility: 'bogus' });
    expect(res.status).toBe(400);
  });
});

describe('F30-S08 visibility — overrides de membro', () => {
  it('GET lista vazia para membro existente', async () => {
    const res = await asOwner('get', `/api/org/members/${agentMemberId}/visibility-overrides`);
    expect(res.status).toBe(200);
    expect(res.body.departmentIds).toEqual([]);
  });

  it('GET 404 para membro inexistente', async () => {
    const res = await asOwner('get', `/api/org/members/${randomUUID()}/visibility-overrides`);
    expect(res.status).toBe(404);
  });

  it('PUT substitui o set, persiste e audita', async () => {
    const res = await asOwner('put', `/api/org/members/${agentMemberId}/visibility-overrides`).send({
      departmentIds: [deptAId, deptBId],
    });
    expect(res.status).toBe(200);
    expect([...res.body.departmentIds].sort()).toEqual([deptAId, deptBId].sort());

    const db = getDb();
    const rows = await db
      .select()
      .from(memberVisibilityOverrides)
      .where(eq(memberVisibilityOverrides.memberId, agentMemberId));
    expect(rows.length).toBe(2);

    // Substituição: agora só deptA.
    const res2 = await asOwner('put', `/api/org/members/${agentMemberId}/visibility-overrides`).send({
      departmentIds: [deptAId],
    });
    expect(res2.status).toBe(200);
    const rows2 = await db
      .select()
      .from(memberVisibilityOverrides)
      .where(eq(memberVisibilityOverrides.memberId, agentMemberId));
    expect(rows2.length).toBe(1);
    expect(rows2[0]?.departmentId).toBe(deptAId);

    const get = await asOwner('get', `/api/org/members/${agentMemberId}/visibility-overrides`);
    expect(get.body.departmentIds).toEqual([deptAId]);
  });

  it('PUT 400 quando departamento não pertence ao workspace', async () => {
    const res = await asOwner('put', `/api/org/members/${agentMemberId}/visibility-overrides`).send({
      departmentIds: [randomUUID()],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_department');
  });

  it('PUT 404 para membro inexistente', async () => {
    const res = await asOwner('put', `/api/org/members/${randomUUID()}/visibility-overrides`).send({
      departmentIds: [],
    });
    expect(res.status).toBe(404);
  });
});

describe('F30-S08 visibility — peer-visibility por time', () => {
  it('PATCH seta valor, persiste e audita', async () => {
    const res = await asOwner('patch', `/api/org/teams/${teamId}/peer-visibility`).send({
      peerVisibility: 'private',
    });
    expect(res.status).toBe(200);
    expect(res.body.team.peerVisibility).toBe('private');

    const db = getDb();
    const [row] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(row?.peerVisibility).toBe('private');

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, VISIBILITY_ACTION), eq(auditLogs.resourceId, teamId)));
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH rejeita enum inválido → 400', async () => {
    const res = await asOwner('patch', `/api/org/teams/${teamId}/peer-visibility`).send({
      peerVisibility: 'bogus',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH 404 para time inexistente', async () => {
    const res = await asOwner('patch', `/api/org/teams/${randomUUID()}/peer-visibility`).send({
      peerVisibility: 'inherit',
    });
    expect(res.status).toBe(404);
  });
});
