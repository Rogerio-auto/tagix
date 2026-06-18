/**
 * F38-S07 — chat de suporte do membro. Integração real contra Postgres dev.
 * Cobre: abrir/listar/responder/resolver, RLS por workspace, e IDOR
 * (assertThreadVisible → 404 ao tocar thread de outro workspace).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../auth/session';
import { createSupportRouter } from './support';

const { workspaces, members } = schema;

let wsA = '';
let wsB = '';
let cookieA = '';
let cookieB = '';
const sfx = randomUUID().slice(0, 8);

const app = express();
app.use(express.json());
app.use(createSupportRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;

beforeAll(async () => {
  const db = getDb();
  const [a] = await db.insert(workspaces).values({ name: 'Sup A', slug: `supa-${sfx}` }).returning();
  const [b] = await db.insert(workspaces).values({ name: 'Sup B', slug: `supb-${sfx}` }).returning();
  wsA = a!.id;
  wsB = b!.id;
  const aAuth = randomUUID();
  const aEmail = `supa-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsA, authUserId: aAuth, email: aEmail, role: 'AGENT', status: 'active' });
  cookieA = cookieFor(aAuth, aEmail);
  const bAuth = randomUUID();
  const bEmail = `supb-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: wsB, authUserId: bAuth, email: bEmail, role: 'AGENT', status: 'active' });
  cookieB = cookieFor(bAuth, bEmail);
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

const asA = (m: 'get' | 'post', p: string) => request(app)[m](p).set('Cookie', cookieA);
const asB = (m: 'get' | 'post', p: string) => request(app)[m](p).set('Cookie', cookieB);

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/support/threads')).status).toBe(401);
  });
});

describe('ciclo do membro', () => {
  let threadA = '';

  it('abre thread com 1a mensagem', async () => {
    const res = await asA('post', '/api/support/threads').send({
      subject: 'Não consigo conectar o WhatsApp',
      message: 'Aparece erro ao autenticar com a Meta.',
      priority: 'high',
    });
    expect(res.status).toBe(201);
    expect(res.body.thread.status).toBe('open');
    expect(res.body.thread.priority).toBe('high');
    expect(res.body.message.senderType).toBe('member');
    threadA = res.body.thread.id;
  });

  it('lista só os próprios threads', async () => {
    const a = await asA('get', '/api/support/threads');
    expect(a.status).toBe(200);
    expect(a.body.threads.some((t: { id: string }) => t.id === threadA)).toBe(true);
    const b = await asB('get', '/api/support/threads');
    expect(b.body.threads.some((t: { id: string }) => t.id === threadA)).toBe(false);
  });

  it('GET :id retorna thread + mensagens', async () => {
    const res = await asA('get', `/api/support/threads/${threadA}`);
    expect(res.status).toBe(200);
    expect(res.body.thread.id).toBe(threadA);
    expect(res.body.messages.length).toBe(1);
  });

  it('nova mensagem do membro avança last_message_at', async () => {
    const res = await asA('post', `/api/support/threads/${threadA}/messages`).send({ body: 'Já tentei de novo.' });
    expect(res.status).toBe(201);
    const after = await asA('get', `/api/support/threads/${threadA}`);
    expect(after.body.messages.length).toBe(2);
  });

  it('resolve marca status=resolved', async () => {
    const res = await asA('post', `/api/support/threads/${threadA}/resolve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.thread.status).toBe('resolved');
  });

  it('IDOR: B não vê nem toca o thread de A → 404 (não 403)', async () => {
    const get = await asB('get', `/api/support/threads/${threadA}`);
    expect(get.status).toBe(404);
    const msg = await asB('post', `/api/support/threads/${threadA}/messages`).send({ body: 'invadindo' });
    expect(msg.status).toBe(404);
    const resolve = await asB('post', `/api/support/threads/${threadA}/resolve`).send({});
    expect(resolve.status).toBe(404);
  });

  it('400 com body inválido ao abrir', async () => {
    const res = await asA('post', '/api/support/threads').send({ subject: '', message: '' });
    expect(res.status).toBe(400);
  });
});
