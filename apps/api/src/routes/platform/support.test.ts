/**
 * F38-S10 — inbox de suporte (platform-admin). Integração real contra Postgres dev.
 * Cobre: gate 401/403 (+ audit), triagem cross-workspace com filtros, reply,
 * patch status/priority/assign, e auditoria das mutações.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, supportRepo, withWorkspace } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformSupportRouter } from './support';

const { workspaces, members } = schema;

let wsA = '';
let memberA = '';
let adminWs = '';
let adminCookie = '';
let userCookie = '';
let threadA = '';
const sfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createPlatformSupportRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const admin = (m: 'get' | 'post' | 'patch', p: string) => request(app)[m](p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const [a] = await db.insert(workspaces).values({ name: 'PSup A', slug: `psupa-${sfx}` }).returning();
  const [adm] = await db.insert(workspaces).values({ name: 'PSup Adm', slug: `psupadm-${sfx}` }).returning();
  wsA = a!.id;
  adminWs = adm!.id;

  const [m] = await db
    .insert(members)
    .values({ workspaceId: wsA, authUserId: randomUUID(), email: `psupm-${sfx}@t.local`, role: 'AGENT', status: 'active' })
    .returning();
  memberA = m!.id;

  const aAuth = randomUUID();
  const aEmail = `psupadmin-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: adminWs, authUserId: aAuth, email: aEmail, role: 'OWNER', status: 'active', isPlatformAdmin: true });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `psupuser-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsA, authUserId: uAuth, email: uEmail, role: 'OWNER', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);

  // Thread aberta pelo membro de A (objeto de triagem).
  const t = await withWorkspace(wsA, (tx) =>
    supportRepo.createThread(tx, { workspaceId: wsA, openedBy: memberA, subject: `Triagem ${sfx}`, priority: 'high' }),
  );
  threadA = t.id;
  await withWorkspace(wsA, (tx) =>
    supportRepo.addMessage(tx, { threadId: threadA, senderType: 'member', senderId: memberA, body: 'preciso de ajuda' }),
  );
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (adminWs) await db.delete(workspaces).where(eq(workspaces.id, adminWs));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/platform/support/threads')).status).toBe(401);
  });
  it('não-admin → 403', async () => {
    const res = await request(app).get('/api/platform/support/threads').set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });
});

describe('triagem + reply + patch', () => {
  it('lista cross-workspace e filtra por status/priority', async () => {
    const all = await admin('get', '/api/platform/support/threads');
    expect(all.status).toBe(200);
    expect(all.body.threads.some((t: { id: string }) => t.id === threadA)).toBe(true);

    const high = await admin('get', '/api/platform/support/threads?priority=high&status=open');
    expect(high.body.threads.some((t: { id: string }) => t.id === threadA)).toBe(true);

    const low = await admin('get', '/api/platform/support/threads?priority=low');
    expect(low.body.threads.some((t: { id: string }) => t.id === threadA)).toBe(false);
  });

  it('GET :id traz thread + mensagens do membro', async () => {
    const res = await admin('get', `/api/platform/support/threads/${threadA}`);
    expect(res.status).toBe(200);
    expect(res.body.thread.id).toBe(threadA);
    expect(res.body.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('reply da equipe grava mensagem platform', async () => {
    const res = await admin('post', `/api/platform/support/threads/${threadA}/messages`).send({ body: 'Olá, vamos resolver.' });
    expect(res.status).toBe(201);
    expect(res.body.message.senderType).toBe('platform');
    const detail = await admin('get', `/api/platform/support/threads/${threadA}`);
    expect(detail.body.messages.some((m: { senderType: string }) => m.senderType === 'platform')).toBe(true);
  });

  it('patch status/priority/assign + audita', async () => {
    const res = await admin('patch', `/api/platform/support/threads/${threadA}`).send({ status: 'pending', priority: 'normal', assignedTo: memberA });
    expect(res.status).toBe(200);
    expect(res.body.thread.status).toBe('pending');
    expect(res.body.thread.priority).toBe('normal');
    expect(res.body.thread.assignedTo).toBe(memberA);

    const audited = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, threadA));
    expect(audited.some((a) => a.action === 'support.platform_updated')).toBe(true);
    expect(audited.some((a) => a.action === 'support.platform_replied')).toBe(true);
  });

  it('patch vazio → 400; thread inexistente → 404', async () => {
    expect((await admin('patch', `/api/platform/support/threads/${threadA}`).send({})).status).toBe(400);
    expect((await admin('get', `/api/platform/support/threads/${randomUUID()}`)).status).toBe(404);
  });
});
