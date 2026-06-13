/**
 * F25-S01 — requirePlatformAdmin contra a infra dev real.
 *
 * Sessão via MockAuthProvider (AUTH_PROVIDER=mock): seedamos um OWNER comum e um
 * platform admin (members.is_platform_admin=true) e exercitamos o gate:
 *  - sem cookie → 401 (sem audit, não há actor);
 *  - autenticado não-admin → 403 + audit_logs(platform.access_denied);
 *  - platform admin → next() (200).
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../auth/session';
import { requirePlatformAdmin } from './platform-admin';

const { workspaces, members, auditLogs } = schema;

let ws = '';
let adminCookie = '';
let userCookie = '';
let userMemberId = '';

const app = express();
app.use(express.json());
app.get('/platform/ping', ...requirePlatformAdmin, (_req, res) => {
  res.json({ ok: true });
});

const cookieFor = (authUserId: string, email: string): string => {
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
};

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db.insert(workspaces).values({ name: 'Plat', slug: `plat-${sfx}` }).returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const adminAuth = randomUUID();
  const adminEmail = `admin-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: ws,
    authUserId: adminAuth,
    email: adminEmail,
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: true,
  });
  adminCookie = cookieFor(adminAuth, adminEmail);

  const userAuth = randomUUID();
  const userEmail = `user-${sfx}@t.local`;
  const [u] = await db
    .insert(members)
    .values({ workspaceId: ws, authUserId: userAuth, email: userEmail, role: 'OWNER', status: 'active' })
    .returning();
  if (!u) throw new Error('member');
  userMemberId = u.id;
  userCookie = cookieFor(userAuth, userEmail);
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('requirePlatformAdmin', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/platform/ping')).status).toBe(401);
  });

  it('autenticado não-admin → 403 e grava audit_logs(platform.access_denied)', async () => {
    const res = await request(app).get('/platform/ping').set('Cookie', userCookie);
    expect(res.status).toBe(403);

    // Audit é best-effort/assíncrono; pequena espera e checa.
    await new Promise((r) => setTimeout(r, 150));
    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorMemberId, userMemberId),
          eq(auditLogs.action, 'platform.access_denied'),
        ),
      );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.actorType).toBe('platform_admin');
  });

  it('platform admin → next() (200)', async () => {
    const res = await request(app).get('/platform/ping').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
