/**
 * F10-S02 — privacidade/LGPD. Caminho COMPLETO contra a infra dev:
 * - gate de sessão (sem auth → 401) e de permissão (AGENT → 403).
 * - export assíncrono: cria job (workspace e contato), 404 p/ contato inexistente,
 *   status do job pending (sem downloadUrl).
 * - forget: anonimiza o contato (token determinístico + soft-delete), redige o corpo
 *   das mensagens e registra `audit_logs`. RLS isola tudo por workspace.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { IStorageDriver } from '@hm/storage';
import { SESSION_COOKIE } from '../../auth/session';
import { deterministicToken, REDACTED_TEXT } from '../../services/privacy';
import { createPrivacyRouter } from './index';

const { workspaces, members, channels, contacts, conversations, messages, deals, pipelines, stages, auditLogs } =
  schema;

// Storage fake: o teste de status pending não chega a tocar nele; o de done usaria.
const fakeStorage: IStorageDriver = {
  async put() {},
  async getSignedUrl(key) {
    return { url: `https://fake.local/${key}?sig=test`, expiresAt: new Date(Date.now() + 60_000) };
  },
  async delete() {},
};

let ws = '';
let ownerCookie = '';
let agentCookie = '';

const authedApp = express();
authedApp.use(express.json());
authedApp.use(createPrivacyRouter(fakeStorage));

const rawApp = express();
rawApp.use(express.json());
rawApp.use(createPrivacyRouter(fakeStorage));

const asOwner = (m: 'get' | 'post', path: string) =>
  request(authedApp)[m](path).set('Cookie', ownerCookie);
const asAgent = (m: 'get' | 'post', path: string) =>
  request(authedApp)[m](path).set('Cookie', agentCookie);

function mockCookie(authUserId: string, email: string): string {
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString('base64url');
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'LGPD', slug: `lgpd-${sfx}` }).returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const ownerAuth = randomUUID();
  const ownerEmail = `owner-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: ownerAuth, email: ownerEmail, role: 'OWNER', status: 'active' });
  ownerCookie = mockCookie(ownerAuth, ownerEmail);

  const agentAuth = randomUUID();
  const agentEmail = `agent-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: agentAuth, email: agentEmail, role: 'AGENT', status: 'active' });
  agentCookie = mockCookie(agentAuth, agentEmail);
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gates (auth + permissão)', () => {
  it('sem sessão → 401', async () => {
    expect((await request(rawApp).post('/api/privacy/exports').send({ scope: 'workspace' })).status).toBe(401);
    expect((await request(rawApp).post(`/api/privacy/contacts/${randomUUID()}/forget`)).status).toBe(401);
  });
  it('AGENT não tem permissão → 403', async () => {
    expect((await asAgent('post', '/api/privacy/exports').send({ scope: 'workspace' })).status).toBe(403);
    expect((await asAgent('post', `/api/privacy/contacts/${randomUUID()}/forget`)).status).toBe(403);
  });
});

describe('export assíncrono', () => {
  it('cria job de workspace (202 + jobId) e lê status pending (sem downloadUrl)', async () => {
    const create = await asOwner('post', '/api/privacy/exports').send({ scope: 'workspace' });
    expect(create.status).toBe(202);
    expect(create.body.jobId).toMatch(/^[0-9a-f-]{36}$/);

    const status = await asOwner('get', `/api/privacy/exports/${create.body.jobId}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('pending');
    expect(status.body.downloadUrl).toBeUndefined();
  });

  it('cria job de contato existente (202) e nega contato inexistente (404)', async () => {
    const [ct] = await getDb()
      .insert(contacts)
      .values({ workspaceId: ws, displayName: 'Titular', phone: '+5511999990000' })
      .returning();
    if (!ct) throw new Error('contact');

    const ok = await asOwner('post', '/api/privacy/exports').send({ scope: { contactId: ct.id } });
    expect(ok.status).toBe(202);

    const missing = await asOwner('post', '/api/privacy/exports').send({ scope: { contactId: randomUUID() } });
    expect(missing.status).toBe(404);
  });

  it('rejeita body inválido (400) e id inválido no status (400)', async () => {
    expect((await asOwner('post', '/api/privacy/exports').send({ scope: 'bogus' })).status).toBe(400);
    expect((await asOwner('get', '/api/privacy/exports/not-a-uuid')).status).toBe(400);
  });
});

describe('forget (anonimização + audit)', () => {
  it('anonimiza contato, redige mensagens e grava audit_logs', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [ch] = await db
      .insert(channels)
      .values({ workspaceId: ws, provider: 'meta_whatsapp', name: `WA ${sfx}`, phoneNumberId: `p-${sfx}`, wabaId: `w-${sfx}` })
      .returning();
    const [ct] = await db
      .insert(contacts)
      .values({ workspaceId: ws, displayName: 'João Silva', phone: '+5511988887777', email: `joao-${sfx}@t.local`, notes: 'cliente VIP' })
      .returning();
    if (!ch || !ct) throw new Error('setup ch/ct');

    const [conv] = await db
      .insert(conversations)
      .values({ workspaceId: ws, channelId: ch.id, contactId: ct.id, remoteId: `r-${sfx}`, lastMessagePreview: 'meu CPF é 123' })
      .returning();
    if (!conv) throw new Error('conv');
    await db.insert(messages).values({
      workspaceId: ws,
      conversationId: conv.id,
      direction: 'inbound',
      senderType: 'contact',
      content: 'Meu CPF é 123.456.789-00 e moro na Rua X',
    });

    // Pipeline mínimo p/ um deal do contato.
    const [pl] = await db.insert(pipelines).values({ workspaceId: ws, name: 'P', isDefault: true }).returning();
    if (!pl) throw new Error('pipeline');
    const [st] = await db.insert(stages).values({ workspaceId: ws, pipelineId: pl.id, name: 'Novo', position: 0 }).returning();
    if (!st) throw new Error('stage');
    await db.insert(deals).values({
      workspaceId: ws,
      pipelineId: pl.id,
      stageId: st.id,
      contactId: ct.id,
      title: 'Deal João',
      notes: 'ligar no celular pessoal',
    });

    const res = await asOwner('post', `/api/privacy/contacts/${ct.id}/forget`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anonymized: true });

    // Contato anonimizado: token determinístico + PII nula + soft-delete.
    const [after] = await db.select().from(contacts).where(eq(contacts.id, ct.id));
    expect(after?.displayName).toBe(deterministicToken(ws, ct.id));
    expect(after?.phone).toBeNull();
    expect(after?.email).toBeNull();
    expect(after?.notes).toBeNull();
    expect(after?.deletedAt).toBeTruthy();

    // Mensagem redigida; preview limpo; deal mantido mas com notes nula.
    const [msg] = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msg?.content).toBe(REDACTED_TEXT);
    const [convAfter] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(convAfter?.lastMessagePreview).toBeNull();
    const [dealAfter] = await db.select().from(deals).where(eq(deals.contactId, ct.id));
    expect(dealAfter).toBeDefined(); // agregado preservado
    expect(dealAfter?.notes).toBeNull();

    // Audit log da operação.
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'privacy.contact_forgotten'), eq(auditLogs.resourceId, ct.id)));
    expect(log).toBeDefined();
    expect(log?.workspaceId).toBe(ws);
    expect(log?.resourceType).toBe('contact');
  });

  it('contato inexistente → 404', async () => {
    expect((await asOwner('post', `/api/privacy/contacts/${randomUUID()}/forget`)).status).toBe(404);
  });
});
