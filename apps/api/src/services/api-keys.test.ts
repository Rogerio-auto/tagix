/**
 * F9-S02 — API key auth + rate limit. Integração real contra o Postgres dev (lookup
 * de chave, expiração/revogação) e o Redis dev (sliding window do rate limit), via
 * Express in-memory com supertest. Sem mocks de infra (DB/Redis UP).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import {
  closeApiKeyRateLimiter,
  requireApiKey,
  requireScope,
} from '../middlewares/api-key';
import {
  extractBearerToken,
  generateApiKey,
  hashToken,
  lookupApiKey,
} from './api-keys';

const { workspaces, apiKeys } = schema;

let ws = '';

/** Insere uma api_key e devolve o token claro. */
async function seedKey(opts: {
  scopes?: string[];
  rateLimitPerMinute?: number;
  isActive?: boolean;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<string> {
  const gen = generateApiKey();
  await getDb()
    .insert(apiKeys)
    .values({
      workspaceId: ws,
      name: `k-${randomUUID().slice(0, 6)}`,
      keyHash: gen.keyHash,
      keyPrefix: gen.keyPrefix,
      scopes: opts.scopes ?? [],
      rateLimitPerMinute: opts.rateLimitPerMinute ?? 60,
      isActive: opts.isActive ?? true,
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    });
  return gen.token;
}

function appWith(scope?: string) {
  const app = express();
  const handlers: RequestHandler[] = [requireApiKey];
  if (scope) handlers.push(requireScope(scope));
  app.get('/v1/ping', ...handlers, (req, res) => {
    res.json({ ok: true, workspaceId: req.apiAuth?.workspaceId });
  });
  return app;
}

beforeAll(async () => {
  const sfx = randomUUID().slice(0, 8);
  const [w] = await getDb()
    .insert(workspaces)
    .values({ name: 'APIKey', slug: `apikey-${sfx}` })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeApiKeyRateLimiter();
  await closeDb();
});

describe('token helpers', () => {
  it('generateApiKey produz hm_ token, hash SHA-256 e prefixo consistentes', () => {
    const k = generateApiKey();
    expect(k.token.startsWith('hm_')).toBe(true);
    expect(k.keyHash).toHaveLength(64);
    expect(k.keyHash).toBe(hashToken(k.token));
    expect(k.token.startsWith(k.keyPrefix)).toBe(true);
  });

  it('extractBearerToken aceita Bearer hm_… e rejeita o resto', () => {
    expect(extractBearerToken('Bearer hm_abc')).toBe('hm_abc');
    expect(extractBearerToken('bearer hm_abc')).toBe('hm_abc');
    expect(extractBearerToken('hm_abc')).toBeNull();
    expect(extractBearerToken('Bearer xx_abc')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});

describe('lookupApiKey', () => {
  it('resolve chave ativa para workspace/scopes', async () => {
    const token = await seedKey({ scopes: ['read:conversations'], rateLimitPerMinute: 99 });
    const auth = await lookupApiKey(token);
    expect(auth?.workspaceId).toBe(ws);
    expect(auth?.scopes).toEqual(['read:conversations']);
    expect(auth?.rateLimitPerMinute).toBe(99);
  });

  it('rejeita revogada, inativa, expirada e token desconhecido', async () => {
    const revoked = await seedKey({ revokedAt: new Date() });
    const inactive = await seedKey({ isActive: false });
    const expired = await seedKey({ expiresAt: new Date(Date.now() - 1000) });
    expect(await lookupApiKey(revoked)).toBeNull();
    expect(await lookupApiKey(inactive)).toBeNull();
    expect(await lookupApiKey(expired)).toBeNull();
    expect(await lookupApiKey('hm_naoexiste')).toBeNull();
  });

  it('aceita chave com expires_at no futuro', async () => {
    const token = await seedKey({ expiresAt: new Date(Date.now() + 60_000) });
    expect(await lookupApiKey(token)).not.toBeNull();
  });
});

describe('requireApiKey middleware', () => {
  it('401 sem Authorization', async () => {
    const res = await request(appWith()).get('/v1/ping');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('401 com token inválido/revogado', async () => {
    const revoked = await seedKey({ revokedAt: new Date() });
    const res = await request(appWith()).get('/v1/ping').set('Authorization', `Bearer ${revoked}`);
    expect(res.status).toBe(401);
  });

  it('200 + injeta workspace + headers de rate limit com token válido', async () => {
    const token = await seedKey({ rateLimitPerMinute: 60 });
    const res = await request(appWith()).get('/v1/ping').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(ws);
    expect(res.headers['x-ratelimit-limit']).toBe('60');
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(60);
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('atualiza last_used_at após request válida', async () => {
    const token = await seedKey({});
    await request(appWith()).get('/v1/ping').set('Authorization', `Bearer ${token}`);
    // espera o void touch resolver
    await new Promise((r) => setTimeout(r, 150));
    const [row] = await getDb()
      .select({ lastUsedAt: apiKeys.lastUsedAt })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashToken(token)));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('429 ao exceder rate_limit_per_minute, com Retry-After', async () => {
    const token = await seedKey({ rateLimitPerMinute: 3 });
    const app = appWith();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app).get('/v1/ping').set('Authorization', `Bearer ${token}`);
      codes.push(r.status);
      if (r.status === 429) {
        expect(r.body.error).toBe('rate_limited');
        expect(r.headers['retry-after']).toBeDefined();
      }
    }
    expect(codes.filter((c) => c === 200).length).toBe(3);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });
});

describe('requireScope middleware', () => {
  it('403 quando o scope está ausente', async () => {
    const token = await seedKey({ scopes: ['read:conversations'] });
    const res = await request(appWith('write:messages'))
      .get('/v1/ping')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 quando o scope está presente', async () => {
    const token = await seedKey({ scopes: ['write:messages'], rateLimitPerMinute: 100 });
    const res = await request(appWith('write:messages'))
      .get('/v1/ping')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
