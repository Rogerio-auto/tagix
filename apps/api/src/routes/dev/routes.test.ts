/**
 * F9-S04 — gestão Dev (API keys + webhooks). Caminho COMPLETO contra a infra dev:
 * - gate de sessão: rotas sem sessão → 401 (routers reais).
 * - fluxo autenticado real: cookie de sessão (AUTH_PROVIDER=mock) de um OWNER seedado
 *   passa por requireAuth/withRLS/requireRole; os handlers rodam contra Postgres (RLS).
 *   Cobre show-once do token, listagem sem hash, revogação, CRUD de webhook com segredo
 *   cifrado (não exposto) e log de deliveries.
 *
 * Entrega de teste (F70-S20): o POST real sai para um receptor HTTP local, que a
 * verifica como um cliente de verdade, com o verificador de referência
 * (`verifyWebhookSignature`). O receptor escuta em 127.0.0.1, liberado só aqui pela
 * allowlist do operador (`HM_WEBHOOK_HTTP_ALLOWLIST`), como no e2e dos workers.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, encryptSecret, getDb, schema } from '@hm/db';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from '@hm/shared/mq';
import { SESSION_COOKIE } from '../../auth/session';
import { createDevApiKeysRouter } from './api-keys';
import { buildTestDelivery, createDevWebhooksRouter, WEBHOOK_TEST_EVENT } from './webhooks';
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

/** Uma requisição capturada pelo receptor local (bytes crus, como o cliente vê). */
interface Captured {
  readonly headers: IncomingHttpHeaders;
  readonly raw: Buffer;
}

function header(h: IncomingHttpHeaders, name: string): string | undefined {
  const v = h[name];
  return typeof v === 'string' ? v : undefined;
}

describe('entrega de teste assinada no formato novo (F70-S20)', () => {
  const SECRET = `ping-secret-${randomUUID()}`;
  const captured: Captured[] = [];
  let server: Server;
  let hookId = '';
  const previousAllowlist = process.env['HM_WEBHOOK_HTTP_ALLOWLIST'];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        captured.push({ headers: req.headers, raw: Buffer.concat(chunks) });
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    process.env['HM_WEBHOOK_HTTP_ALLOWLIST'] = '127.0.0.1';

    // Semeado direto (a rota de criação exige https): o segredo é cifrado como na rota.
    const [hook] = await getDb()
      .insert(outboundWebhooks)
      .values({
        workspaceId: ws,
        name: 'Receptor local',
        url: `http://127.0.0.1:${port}/hook`,
        events: ['message.sent'],
        isActive: true,
        secretEnc: encryptSecret(SECRET),
      })
      .returning({ id: outboundWebhooks.id });
    if (!hook) throw new Error('webhook');
    hookId = hook.id;
  });

  afterAll(async () => {
    if (previousAllowlist === undefined) delete process.env['HM_WEBHOOK_HTTP_ALLOWLIST'];
    else process.env['HM_WEBHOOK_HTTP_ALLOWLIST'] = previousAllowlist;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('o ping chega com a anatomia de uma entrega real e o verificador de referência aceita', async () => {
    captured.length = 0;
    const res = await authed('post', `/api/dev/webhooks/${hookId}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ delivered: true, status: 200 });

    expect(captured).toHaveLength(1);
    const got = captured[0]!;
    const signature = header(got.headers, SIGNATURE_HEADER);
    const timestamp = header(got.headers, TIMESTAMP_HEADER);
    expect(timestamp).toMatch(/^\d{10}$/);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(header(got.headers, 'x-hm-event')).toBe(WEBHOOK_TEST_EVENT);
    expect(header(got.headers, 'content-type')).toBe('application/json');

    const verdict = verifyWebhookSignature({ secret: SECRET, body: got.raw, signature, timestamp });
    expect(verdict).toEqual({ ok: true, timestamp: Number(timestamp) });

    const body = JSON.parse(got.raw.toString('utf8')) as Record<string, unknown>;
    expect(body['_meta']).toMatchObject({ event: WEBHOOK_TEST_EVENT });
    expect(String((body['_meta'] as { eventId: string }).eventId)).toMatch(/^webhook\.test:/);
    // Nada do workspace sai no corpo do ping.
    expect(got.raw.toString('utf8')).not.toContain(ws);
  });

  it('ping com timestamp adulterado é recusado; segredo errado e replay também', async () => {
    captured.length = 0;
    await authed('post', `/api/dev/webhooks/${hookId}/test`);
    const got = captured[0]!;
    const signature = header(got.headers, SIGNATURE_HEADER);
    const timestamp = header(got.headers, TIMESTAMP_HEADER);
    const ts = Number(timestamp);

    // Timestamp trocado (dentro da janela): o HMAC não bate, porque o ts é assinado.
    expect(
      verifyWebhookSignature({ secret: SECRET, body: got.raw, signature, timestamp: String(ts - 1) }),
    ).toEqual({ ok: false, reason: 'mismatch' });
    // Corpo adulterado.
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: Buffer.concat([got.raw, Buffer.from(' ')]),
        signature,
        timestamp,
      }),
    ).toEqual({ ok: false, reason: 'mismatch' });
    // Segredo errado.
    expect(
      verifyWebhookSignature({ secret: `${SECRET}x`, body: got.raw, signature, timestamp }),
    ).toEqual({ ok: false, reason: 'mismatch' });
    // O mesmo ping reenviado depois da janela.
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: got.raw,
        signature,
        timestamp,
        now: new Date((ts + WEBHOOK_TOLERANCE_SECONDS + 1) * 1000),
      }),
    ).toEqual({ ok: false, reason: 'outside_tolerance' });
  });

  it('buildTestDelivery assina com o instante dado (mesmo signer do dispatcher)', () => {
    const at = new Date('2026-09-25T12:00:00.000Z');
    const d = buildTestDelivery(SECRET, at);
    expect(d.headers[TIMESTAMP_HEADER]).toBe(String(Math.floor(at.getTime() / 1000)));
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: d.body,
        signature: d.headers[SIGNATURE_HEADER],
        timestamp: d.headers[TIMESTAMP_HEADER],
        now: at,
      }).ok,
    ).toBe(true);
    expect(JSON.parse(d.body)).toMatchObject({ _meta: { occurredAt: at.toISOString() } });
  });
});
