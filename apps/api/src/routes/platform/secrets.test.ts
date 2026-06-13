/**
 * F25-S04 — rotação de platform_secrets (infra dev real).
 *
 * - Gate (401/403).
 * - GET lista metadados sem valor em claro.
 * - PUT cifra (value_enc ≠ valor), key_version++, grava audit; valor nunca aparece
 *   na resposta nem no log.
 * - Key desconhecida → 400.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformSecretsRouter } from './secrets';

const { workspaces, members, platformSecrets, auditLogs } = schema;

let ws = '';
let adminCookie = '';
let userCookie = '';
const SECRET = `super-secret-${randomUUID()}`;

const app = express();
app.use(express.json());
app.use(createPlatformSecretsRouter());

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;
const adminReq = (m: 'get' | 'put', p: string) => request(app)[m](p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'Sec', slug: `sec-${sfx}` }).returning();
  ws = w!.id;
  // Limpa a key de teste para garantir key_version determinístico (1 no 1º set).
  await db.delete(platformSecrets).where(eq(platformSecrets.key, 'meta_app_secret'));

  const aAuth = randomUUID();
  const aEmail = `sadmin-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: ws, authUserId: aAuth, email: aEmail, role: 'OWNER', status: 'active', isPlatformAdmin: true });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `suser-${sfx}@t.local`;
  await db.insert(members).values({ workspaceId: ws, authUserId: uAuth, email: uEmail, role: 'OWNER', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  await db.delete(platformSecrets).where(eq(platformSecrets.key, 'meta_app_secret'));
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/platform/secrets')).status).toBe(401);
  });
  it('não-admin → 403', async () => {
    expect((await request(app).get('/api/platform/secrets').set('Cookie', userCookie)).status).toBe(403);
  });
});

describe('GET (metadados, sem valor)', () => {
  it('lista keys conhecidas sem expor valor', async () => {
    const res = await adminReq('get', '/api/platform/secrets');
    expect(res.status).toBe(200);
    const keys = res.body.secrets.map((s: { key: string }) => s.key);
    expect(keys).toContain('openrouter_api_key');
    expect(keys).toContain('meta_app_secret');
    for (const s of res.body.secrets) {
      expect(s).not.toHaveProperty('value');
      expect(s).not.toHaveProperty('valueEnc');
    }
  });
});

describe('PUT (rotação)', () => {
  it('cifra, key_version++ e audita; valor nunca aparece', async () => {
    const r1 = await adminReq('put', '/api/platform/secrets/meta_app_secret').send({ value: SECRET });
    expect(r1.status).toBe(200);
    expect(r1.body.secret.keyVersion).toBe(1);
    expect(JSON.stringify(r1.body)).not.toContain(SECRET);

    const r2 = await adminReq('put', '/api/platform/secrets/meta_app_secret').send({ value: SECRET + '-v2' });
    expect(r2.body.secret.keyVersion).toBe(2);

    // No banco, value_enc é ciphertext (iv:tag:ct), nunca o valor em claro.
    const [row] = await getDb().select().from(platformSecrets).where(eq(platformSecrets.key, 'meta_app_secret'));
    expect(row!.valueEnc).toContain(':');
    expect(row!.valueEnc).not.toContain(SECRET);
    expect(row!.keyVersion).toBe(2);

    // Auditoria registrada (sem valor nas metadata).
    const audit = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'platform.secret_rotated')));
    const mine = audit.filter((a) => (a.metadata as { key?: string }).key === 'meta_app_secret');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(mine)).not.toContain(SECRET);
  });

  it('key desconhecida → 400', async () => {
    expect((await adminReq('put', '/api/platform/secrets/nope_key').send({ value: 'x' })).status).toBe(400);
  });

  it('body inválido → 400', async () => {
    expect((await adminReq('put', '/api/platform/secrets/meta_app_secret').send({})).status).toBe(400);
  });
});
