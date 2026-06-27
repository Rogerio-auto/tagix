/**
 * F52-S09 — observabilidade da sincronização (infra dev real, seed determinístico).
 *
 * - Gate: 401 (sem sessão) / 403 (AGENT) / 200 (OWNER/ADMIN).
 * - Filas: agrega profundidade (fetcher injetado) + DLQ + retries em voo.
 * - Pendências: conta mensagens pending/sending (outbound) e mídia failed, RLS-scoped.
 * - Canais: deriva status a partir de isActive/token/qualityRating.
 * - Degrada quando o fetcher de filas lança (mq.reachable=false) sem derrubar o resto.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { DLQ_QUEUE, QUEUES, RETRY_BACKOFF_MS, retryWaitQueueName } from '@hm/shared/mq';
import { SESSION_COOKIE } from '../../auth/session';
import { createMonitoringRouter } from './sync-health';
import type { QueueDepth } from './rabbitmq';

const { workspaces, members, channels, channelSecrets, contacts, conversations, messages } = schema;

let wsId = '';
let adminCookie = '';
let agentCookie = '';

const FIRST_RETRY = retryWaitQueueName(QUEUES.outbound, RETRY_BACKOFF_MS[0]);

const fakeDepths: QueueDepth[] = [
  { name: QUEUES.inbound, vhost: '/', messages: 3, ready: 3, unacked: 0, consumers: 1 },
  { name: QUEUES.outbound, vhost: '/', messages: 7, ready: 5, unacked: 2, consumers: 2 },
  { name: DLQ_QUEUE, vhost: '/', messages: 4, ready: 4, unacked: 0, consumers: 0 },
  { name: FIRST_RETRY, vhost: '/', messages: 2, ready: 2, unacked: 0, consumers: 0 },
];

const okApp = express();
okApp.use(createMonitoringRouter({ fetchQueueDepths: async () => fakeDepths }));

const failApp = express();
failApp.use(
  createMonitoringRouter({
    fetchQueueDepths: async () => {
      throw new Error('management API offline');
    },
  }),
);

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `MON ${sfx}`, slug: `mon-${sfx}` })
    .returning();
  wsId = ws!.id;

  const adminAuth = randomUUID();
  const adminEmail = `mon-admin-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: wsId,
    authUserId: adminAuth,
    email: adminEmail,
    role: 'OWNER',
    status: 'active',
  });
  adminCookie = cookieFor(adminAuth, adminEmail);

  const agentAuth = randomUUID();
  const agentEmail = `mon-agent-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: wsId,
    authUserId: agentAuth,
    email: agentEmail,
    role: 'AGENT',
    status: 'active',
  });
  agentCookie = cookieFor(agentAuth, agentEmail);

  // Canal WhatsApp com quality RED → status 'degraded'; com secret → hasToken.
  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: wsId,
      provider: 'meta_whatsapp',
      name: 'WA Principal',
      phoneNumber: '+550000000000',
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
      metadata: { qualityRating: 'RED' },
    })
    .returning();
  const channelId = ch!.id;
  await db.insert(channelSecrets).values({ channelId, accessTokenEnc: 'enc::token' });

  const [contact] = await db
    .insert(contacts)
    .values({ workspaceId: wsId, displayName: 'Lead' })
    .returning();

  const [conv] = await db
    .insert(conversations)
    .values({ workspaceId: wsId, channelId, contactId: contact!.id, remoteId: `r-${sfx}` })
    .returning();
  const conversationId = conv!.id;

  // 2 outbound presas (pending+sending) → pending.messages = 2.
  // 1 outbound sent + 1 inbound pending → excluídas.
  // 1 mídia outbound failed → mediaFailed = 1. 1 texto failed → excluído.
  await db.insert(messages).values([
    { workspaceId: wsId, conversationId, direction: 'outbound', senderType: 'system', viewStatus: 'pending' },
    { workspaceId: wsId, conversationId, direction: 'outbound', senderType: 'system', viewStatus: 'sending' },
    { workspaceId: wsId, conversationId, direction: 'outbound', senderType: 'system', viewStatus: 'sent' },
    { workspaceId: wsId, conversationId, direction: 'inbound', senderType: 'contact', viewStatus: 'pending' },
    { workspaceId: wsId, conversationId, direction: 'outbound', senderType: 'system', type: 'image', viewStatus: 'failed' },
    { workspaceId: wsId, conversationId, direction: 'outbound', senderType: 'system', type: 'text', viewStatus: 'failed' },
  ]);
});

afterAll(async () => {
  const db = getDb();
  if (wsId) await db.delete(workspaces).where(eq(workspaces.id, wsId));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(okApp).get('/api/monitoring/sync-health')).status).toBe(401);
  });
  it('AGENT → 403', async () => {
    const res = await request(okApp).get('/api/monitoring/sync-health').set('Cookie', agentCookie);
    expect(res.status).toBe(403);
  });
});

describe('snapshot', () => {
  it('OWNER → 200 com filas, DLQ, retries, pendências e canais', async () => {
    const res = await request(okApp).get('/api/monitoring/sync-health').set('Cookie', adminCookie);
    expect(res.status).toBe(200);

    // Filas de trabalho mapeadas (inclui as zeradas que não vieram no fetcher).
    expect(res.body.mq.reachable).toBe(true);
    const outbound = res.body.queues.find((q: { name: string }) => q.name === QUEUES.outbound);
    expect(outbound.messages).toBe(7);
    expect(outbound.unacked).toBe(2);
    expect(res.body.queues.some((q: { name: string }) => q.name === QUEUES.media)).toBe(true);

    // DLQ + retries em voo.
    expect(res.body.dlq.messages).toBe(4);
    expect(res.body.retryInFlight).toBe(2);

    // Pendências RLS-scoped.
    expect(res.body.pending.messages).toBe(2);
    expect(res.body.pending.mediaFailed).toBe(1);

    // Canal WhatsApp: token presente + quality RED → degraded.
    expect(res.body.channels).toHaveLength(1);
    expect(res.body.channels[0].hasToken).toBe(true);
    expect(res.body.channels[0].qualityRating).toBe('RED');
    expect(res.body.channels[0].status).toBe('degraded');
  });

  it('degrada quando o management API falha (mq.reachable=false), mas responde pendências', async () => {
    const res = await request(failApp)
      .get('/api/monitoring/sync-health')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.mq.reachable).toBe(false);
    expect(typeof res.body.mq.error).toBe('string');
    expect(res.body.pending.messages).toBe(2);
    expect(res.body.dlq.messages).toBe(0);
  });
});
