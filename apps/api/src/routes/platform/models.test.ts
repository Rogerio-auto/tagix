/**
 * F25-S02 — catálogo de modelos LLM (CRUD + sync) contra a infra dev real.
 *
 * - Gate: sem sessão → 401; autenticado não-admin → 403 (requirePlatformAdmin).
 * - CRUD: list + PATCH (is_active/notes/default_plan_keys) como platform admin.
 * - Sync: o serviço `syncOpenRouterModels` com fetcher mockado faz upsert por slug,
 *   é idempotente (re-sync não duplica) e lê a key cifrada de platform_secrets
 *   (nunca em claro). Testado no nível de serviço (sem rede).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, encryptSecret, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createPlatformModelsRouter } from './models';
import { syncOpenRouterModels } from '../../services/platform/openrouter-models';

const { workspaces, members, llmModelsWhitelist, platformSecrets } = schema;

let ws = '';
let adminCookie = '';
let userCookie = '';
const SLUG_A = `test-vendor/model-a-${randomUUID().slice(0, 6)}`;
const SLUG_B = `test-vendor/model-b-${randomUUID().slice(0, 6)}`;

const app = express();
app.use(express.json());
app.use(createPlatformModelsRouter());

const cookieFor = (authUserId: string, email: string): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString('base64url'),
  )}`;

const authed = (m: 'get' | 'patch' | 'post', p: string) =>
  request(app)[m](p).set('Cookie', adminCookie);

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'M', slug: `m-${sfx}` }).returning();
  ws = w!.id;

  const aAuth = randomUUID();
  const aEmail = `madmin-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: ws,
    authUserId: aAuth,
    email: aEmail,
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
  });
  adminCookie = cookieFor(aAuth, aEmail);

  const uAuth = randomUUID();
  const uEmail = `muser-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: uAuth, email: uEmail, role: 'OWNER', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  await db.delete(llmModelsWhitelist).where(eq(llmModelsWhitelist.slug, SLUG_A));
  await db.delete(llmModelsWhitelist).where(eq(llmModelsWhitelist.slug, SLUG_B));
  await db.delete(platformSecrets).where(eq(platformSecrets.key, 'openrouter_api_key'));
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('gate', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/platform/models')).status).toBe(401);
  });
  it('não-admin → 403', async () => {
    expect((await request(app).get('/api/platform/models').set('Cookie', userCookie)).status).toBe(
      403,
    );
  });
});

describe('CRUD', () => {
  it('lista (admin) e faz PATCH de is_active/notes/default_plan_keys', async () => {
    const db = getDb();
    const [m] = await db
      .insert(llmModelsWhitelist)
      .values({ slug: SLUG_A, displayName: 'Model A', upstreamProvider: 'test-vendor' })
      .returning();

    const list = await authed('get', '/api/platform/models');
    expect(list.status).toBe(200);
    expect(list.body.models.some((x: { slug: string }) => x.slug === SLUG_A)).toBe(true);

    const patch = await authed('patch', `/api/platform/models/${m!.id}`).send({
      isActive: false,
      notes: 'desligado p/ teste',
      defaultPlanKeys: ['pro', 'enterprise'],
    });
    expect(patch.status).toBe(200);
    expect(patch.body.model.isActive).toBe(false);
    expect(patch.body.model.notes).toBe('desligado p/ teste');
    expect(patch.body.model.defaultPlanKeys).toEqual(['pro', 'enterprise']);
  });

  it('PATCH de id inexistente → 404; body vazio → 400', async () => {
    expect((await authed('patch', `/api/platform/models/${randomUUID()}`).send({ isActive: true })).status).toBe(404);
    const [m] = await getDb().select().from(llmModelsWhitelist).where(eq(llmModelsWhitelist.slug, SLUG_A));
    expect((await authed('patch', `/api/platform/models/${m!.id}`).send({})).status).toBe(400);
  });
});

describe('sync (serviço, fetcher mockado)', () => {
  it('upsert por slug, idempotente, lê key cifrada de platform_secrets', async () => {
    const db = getDb();
    // Seed da key cifrada (nunca em claro no banco).
    await db
      .insert(platformSecrets)
      .values({ key: 'openrouter_api_key', valueEnc: encryptSecret('sk-or-test-key') })
      .onConflictDoUpdate({
        target: platformSecrets.key,
        set: { valueEnc: encryptSecret('sk-or-test-key') },
      });

    const fetcher = async (apiKey: string) => {
      // O serviço passa a key DECIFRADA, não o ciphertext.
      expect(apiKey).toBe('sk-or-test-key');
      return [
        {
          id: SLUG_B,
          name: 'Model B',
          context_length: 128000,
          architecture: { input_modalities: ['text', 'image'] },
          pricing: { prompt: '0.0000005', completion: '0.0000015' },
          supported_parameters: ['tools'],
        },
      ];
    };

    const r1 = await syncOpenRouterModels({ db, fetcher });
    expect(r1.upserted).toBe(1);
    const r2 = await syncOpenRouterModels({ db, fetcher });
    expect(r2.upserted).toBe(1);

    const rows = await db.select().from(llmModelsWhitelist).where(eq(llmModelsWhitelist.slug, SLUG_B));
    expect(rows).toHaveLength(1); // idempotente: sem duplicar
    const row = rows[0]!;
    expect(row.supportsVision).toBe(true);
    expect(row.supportsTools).toBe(true);
    expect(row.contextLength).toBe(128000);
    expect(Number(row.pricingPromptPer1m)).toBeCloseTo(0.5, 4); // 0.0000005 * 1e6
    expect(row.syncedAt).not.toBeNull();

    // A key persiste cifrada (formato iv:tag:ct), nunca em claro.
    const [sec] = await db
      .select()
      .from(platformSecrets)
      .where(sql`${platformSecrets.key} = 'openrouter_api_key'`);
    expect(sec!.valueEnc).toContain(':');
    expect(sec!.valueEnc).not.toContain('sk-or-test-key');
  });

  it('sem key → lança OPENROUTER_KEY_MISSING', async () => {
    const db = getDb();
    await db.delete(platformSecrets).where(eq(platformSecrets.key, 'openrouter_api_key'));
    await expect(
      syncOpenRouterModels({ db, fetcher: async () => [] }),
    ).rejects.toThrow('OPENROUTER_KEY_MISSING');
  });
});
