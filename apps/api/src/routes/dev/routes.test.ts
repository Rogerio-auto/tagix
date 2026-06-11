/**
 * F9-S04 — gestão Dev (API keys + webhooks). Caminho COMPLETO contra a infra dev:
 * - gate de sessão: rotas sem sessão → 401 (routers reais).
 * - fluxo autenticado real: cookie de sessão (AUTH_PROVIDER=mock) de um OWNER seedado
 *   passa por requireAuth/withRLS/requireRole; os handlers rodam contra Postgres (RLS).
 *   Cobre show-once do token, listagem sem hash, revogação, CRUD de webhook com segredo
 *   cifrado (não exposto) e log de deliveries.
 *
 * O HMAC do test-delivery é validado por unidade (assinatura determinística); o POST
 * externo real precisa de URL de cliente — marcado e não exercido aqui.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createDevApiKeysRouter } from './api-keys';
import { createDevWebhooksRouter, __test } from './webhooks';
import { createDevRouter } from './index';

const { workspaces, members, apiKeys, outboundWebhooks, outboundWebhookDeliveries } = schema;

let ws = '';
let cookie = ''; // sessão real (mock provider) do OWNER seedado
/** App autenticado: routers reais; auth via cookie de sessão. */
const authedApp = express();
authedApp.use(express.json());
authedApp.use(createDevApiKeysRouter());
authedApp.use(createDevWebhooksRouter());
/** App sem auth: routers reais → exercita o gate 401. */
const rawApp = express();
rawApp.use(express.json());
rawApp.use(createDevRouter());

/** Requisição autenticada (anexa o cookie de sessão). */
const authed = (m: 'get' | 'post' | 'patch' | 'delete', path: string) =>
  request(authedApp)[m](path).set('Cookie', cookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'Dev', slug: `dev-${sfx}` }).returning();
  if (!w) throw new Error('ws');
  ws = w.id;
  const authUserId = randomUUID();
  const email = `dev-${sfx}@t.local`;
  const [m] = await db
    .insert(members)
    .values({ workspaceId: ws, authUserId, email, role: 'OWNER', status: 'active' })
    .returning();
  if (!m) throw new Error('member');

  // Token do MockAuthProvider: base64url({authUserId,email,iat}). resolveSession
  // resolve member+workspace a partir dele → guards reais passam.
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString('base64url');
  cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gate de sessão (sem auth → 401)', () => {
  it('GET /api/dev/api-keys → 401', async () => {
    expect((await request(rawApp).get('/api/dev/api-keys')).status).toBe(401);
  });
  it('POST /api/dev/api-keys → 401', async () => {
    expect((await request(rawApp).post('/api/dev/api-keys').send({ name: 'x', scopes: ['read:conversations'] })).status).toBe(401);
  });
  it('GET /api/dev/webhooks → 401', async () => {
    expect((await request(rawApp).get('/api/dev/webhooks')).status).toBe(401);
  });
  it('POST /api/dev/webhooks → 401', async () => {
    expect((await request(rawApp).post('/api/dev/webhooks').send({ name: 'x', url: 'https://x.test', events: ['message.sent'] })).status).toBe(401);
  });
});

describe('API keys CRUD', () => {
  it('cria e retorna o token claro UMA vez; listagem não expõe hash', async () => {
    const create = await authed('post', '/api/dev/api-keys')
      .send({ name: 'CI key', scopes: ['read:conversations', 'write:messages'], rateLimitPerMinute: 120 });
    expect(create.status).toBe(201);
    expect(create.body.token).toMatch(/^hm_/);
    expect(create.body.apiKey.keyPrefix).toBeDefined();
    expect(create.body.apiKey).not.toHaveProperty('keyHash');
    const id = create.body.apiKey.id;

    const list = await authed('get', '/api/dev/api-keys');
    expect(list.status).toBe(200);
    const found = list.body.apiKeys.find((k: { id: string }) => k.id === id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('keyHash');
    expect(found).not.toHaveProperty('token');

    // O hash persiste no banco, mas nunca trafega na API.
    const [row] = await getDb().select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(row?.keyHash).toBeTruthy();
    expect(row?.workspaceId).toBe(ws);
  });

  it('rejeita scope desconhecido (400)', async () => {
    const res = await authed('post', '/api/dev/api-keys')
      .send({ name: 'bad', scopes: ['admin:everything'] });
    expect(res.status).toBe(400);
  });

  it('revoga: marca revoked_at + is_active=false; revogar de novo → 404', async () => {
    const create = await authed('post', '/api/dev/api-keys')
      .send({ name: 'to revoke', scopes: ['read:conversations'] });
    const id = create.body.apiKey.id;

    const revoke = await authed('post', `/api/dev/api-keys/${id}/revoke`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.apiKey.isActive).toBe(false);
    expect(revoke.body.apiKey.revokedAt).toBeTruthy();

    const again = await authed('post', `/api/dev/api-keys/${id}/revoke`);
    expect(again.status).toBe(404);
  });
});

describe('Webhooks CRUD', () => {
  it('cria com segredo gerado (show-once), cifra secret_enc, nunca expõe na leitura', async () => {
    const create = await authed('post', '/api/dev/webhooks')
      .send({ name: 'Hook CI', url: 'https://example.test/hook', events: ['message.sent', 'deal.won'] });
    expect(create.status).toBe(201);
    expect(typeof create.body.secret).toBe('string');
    expect(create.body.webhook).not.toHaveProperty('secretEnc');
    const id = create.body.webhook.id;

    // No banco, secret_enc é ciphertext (formato iv:tag:ct), não o segredo claro.
    const [row] = await getDb().select().from(outboundWebhooks).where(eq(outboundWebhooks.id, id));
    expect(row?.secretEnc).toContain(':');
    expect(row?.secretEnc).not.toContain(create.body.secret);

    const list = await authed('get', '/api/dev/webhooks');
    expect(list.body.webhooks.some((h: { id: string }) => h.id === id)).toBe(true);
    expect(list.body.availableEvents).toContain('deal.won');
    const listed = list.body.webhooks.find((h: { id: string }) => h.id === id);
    expect(listed).not.toHaveProperty('secretEnc');
  });

  it('valida evento desconhecido (400)', async () => {
    const res = await authed('post', '/api/dev/webhooks')
      .send({ name: 'bad', url: 'https://x.test', events: ['nope.event'] });
    expect(res.status).toBe(400);
  });

  it('edita (rota PATCH) e deleta (cascade nas deliveries)', async () => {
    const create = await authed('post', '/api/dev/webhooks')
      .send({ name: 'editável', url: 'https://example.test/e', events: ['message.received'] });
    const id = create.body.webhook.id;

    const patch = await authed('patch', `/api/dev/webhooks/${id}`).send({ name: 'renomeado', isActive: false });
    expect(patch.status).toBe(200);
    expect(patch.body.webhook.name).toBe('renomeado');
    expect(patch.body.webhook.isActive).toBe(false);

    // Seed de uma delivery (como owner) → DELETE deve cascatear.
    await getDb().insert(outboundWebhookDeliveries).values({
      webhookId: id,
      workspaceId: ws,
      event: 'message.received',
      payload: { x: 1 },
    });

    const del = await authed('delete', `/api/dev/webhooks/${id}`);
    expect(del.status).toBe(204);
    const remaining = await getDb()
      .select()
      .from(outboundWebhookDeliveries)
      .where(eq(outboundWebhookDeliveries.webhookId, id));
    expect(remaining).toHaveLength(0);
  });

  it('lista o delivery log de um webhook', async () => {
    const create = await authed('post', '/api/dev/webhooks')
      .send({ name: 'com log', url: 'https://example.test/l', events: ['message.sent'] });
    const id = create.body.webhook.id;
    await getDb().insert(outboundWebhookDeliveries).values({
      webhookId: id,
      workspaceId: ws,
      event: 'message.sent',
      payload: { a: 1 },
      status: 'sent',
      responseStatus: 200,
      attempt: 1,
      sentAt: new Date(),
    });
    const log = await authed('get', `/api/dev/webhooks/${id}/deliveries`);
    expect(log.status).toBe(200);
    expect(log.body.deliveries).toHaveLength(1);
    expect(log.body.deliveries[0].status).toBe('sent');
    expect(log.body.deliveries[0]).not.toHaveProperty('payload'); // log enxuto
  });
});

describe('assinatura HMAC do test-delivery', () => {
  it('signPayload é determinística e prefixada com sha256=', () => {
    const a = __test.signPayload('s3cr3t-key-aaaaaaaa', '{"x":1}');
    const b = __test.signPayload('s3cr3t-key-aaaaaaaa', '{"x":1}');
    const c = __test.signPayload('outro-segredo-bbbbbb', '{"x":1}');
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
