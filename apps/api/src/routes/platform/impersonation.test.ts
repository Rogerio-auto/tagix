/**
 * F26-S05 -- API de impersonation (start/end/list). Gate, TTL, reason obrigatorio,
 * audit, kill-switch, cookie de claim.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformImpersonationRouter } from './impersonation';

const { workspaces, members, impersonationSessions, auditLogs } = schema;

let wsAdmin = '';
let wsTarget = '';
let adminCookie = '';
let userCookie = '';
const sfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createPlatformImpersonationRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;

beforeAll(async () => {
  const db = getDb();
  const [wa] = await db
    .insert(workspaces)
    .values({ name: `ImpApiAdmin ${sfx}`, slug: `impapi-admin-${sfx}` })
    .returning();
  const [wt] = await db
    .insert(workspaces)
    .values({ name: `ImpApiTarget ${sfx}`, slug: `impapi-target-${sfx}` })
    .returning();
  wsAdmin = wa!.id;
  wsTarget = wt!.id;

  const aAuth = randomUUID();
  const aEmail = `impapiadmin-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: wsAdmin,
    authUserId: aAuth,
    email: aEmail,
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
  });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `impapiuser-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: wsAdmin, authUserId: uAuth, email: uEmail, role: 'AGENT', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  if (wsTarget) await db.delete(impersonationSessions).where(eq(impersonationSessions.targetWorkspaceId, wsTarget));
  if (wsAdmin) await db.delete(workspaces).where(eq(workspaces.id, wsAdmin));
  if (wsTarget) await db.delete(workspaces).where(eq(workspaces.id, wsTarget));
  await closeDb();
});

describe('gate', () => {
  it('sem sessao -> 401', async () => {
    expect((await request(app).get('/api/platform/impersonation')).status).toBe(401);
  });
  it('nao-admin -> 403', async () => {
    expect(
      (await request(app).get('/api/platform/impersonation').set('Cookie', userCookie)).status,
    ).toBe(403);
  });
});

describe('start / list / end', () => {
  let sessionId = '';

  it('POST sem reason -> 400', async () => {
    const res = await request(app)
      .post('/api/platform/impersonation')
      .set('Cookie', adminCookie)
      .send({ workspaceId: wsTarget });
    expect(res.status).toBe(400);
  });

  it('POST workspace inexistente -> 404', async () => {
    const res = await request(app)
      .post('/api/platform/impersonation')
      .set('Cookie', adminCookie)
      .send({ workspaceId: randomUUID(), reason: 'motivo suficiente aqui' });
    expect(res.status).toBe(404);
  });

  it('POST inicia sessao view (TTL + cookie + audit)', async () => {
    const res = await request(app)
      .post('/api/platform/impersonation')
      .set('Cookie', adminCookie)
      .send({ workspaceId: wsTarget, reason: 'suporte: investigar entrega de webhook' });
    expect(res.status).toBe(201);
    expect(res.body.session.mode).toBe('view');
    expect(res.body.session.targetWorkspaceId).toBe(wsTarget);
    expect(new Date(res.body.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const setCookie = res.headers['set-cookie'];
    expect(String(setCookie)).toContain('hm_impersonation=');
    sessionId = res.body.session.id;

    // Audit do inicio gravado.
    const db = getDb();
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, sessionId), eq(auditLogs.action, 'impersonation.started')));
    expect(row).toBeDefined();
    expect(row!.actorType).toBe('platform_admin');
  });

  it('GET lista a sessao ativa', async () => {
    const res = await request(app).get('/api/platform/impersonation').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.sessions.some((s: { id: string }) => s.id === sessionId)).toBe(true);
  });

  it('DELETE encerra (kill-switch) e limpa cookie', async () => {
    const res = await request(app)
      .delete(`/api/platform/impersonation/${sessionId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.ended).toBe(true);
    expect(String(res.headers['set-cookie'])).toContain('hm_impersonation=;');
  });

  it('apos encerrar, nao aparece mais nas ativas', async () => {
    const res = await request(app).get('/api/platform/impersonation').set('Cookie', adminCookie);
    expect(res.body.sessions.some((s: { id: string }) => s.id === sessionId)).toBe(false);
  });

  it('DELETE sessao inexistente -> 404', async () => {
    const res = await request(app)
      .delete(`/api/platform/impersonation/${randomUUID()}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});
