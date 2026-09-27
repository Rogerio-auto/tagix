/**
 * F70-S30 — trava de origem da IA por workspace: quem altera e a auditoria.
 *
 * Caminho completo contra o Postgres dev: cookie de sessão real (AUTH_PROVIDER=mock) de
 * membros seedados passa por requireAuth/withRLS/requireRole; o handler roda sob RLS.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { SESSION_COOKIE } from '../../auth/session';
import { AI_ORIGIN_LOCK_AUDIT_ACTION } from './ai-origin-lock';
import { createWorkspaceSettingsRouter } from './index';

const { workspaces, members, auditLogs } = schema;
const PATH = '/api/workspace/ai-origin-lock';

const app = express();
app.use(express.json());
app.use(createWorkspaceSettingsRouter());

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('trava de origem da IA — rota (F70-S30)', () => {
  const WS = randomUUID();
  const OTHER_WS = randomUUID();
  const sfx = WS.slice(0, 8);
  const cookies = new Map<Role, string>();
  const memberIds = new Map<Role, string>();
  let otherOwnerCookie = '';

  async function seedMember(workspaceId: string, role: Role, tag: string): Promise<string> {
    const authUserId = randomUUID();
    const email = `f70s30-${tag}-${sfx}@t.local`;
    const [m] = await getDb()
      .insert(members)
      .values({ workspaceId, authUserId, email, name: `F70S30 ${tag}`, role, status: 'active' })
      .returning({ id: members.id });
    if (!m) throw new Error('member');
    const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString(
      'base64url',
    );
    if (workspaceId === WS) memberIds.set(role, m.id);
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
  }

  function as(role: Role) {
    const cookie = cookies.get(role);
    if (!cookie) throw new Error(`sem sessão para ${role}`);
    return {
      get: () => request(app).get(PATH).set('Cookie', cookie),
      patch: (body: unknown) => request(app).patch(PATH).set('Cookie', cookie).send(body as object),
    };
  }

  async function lockValue(workspaceId = WS): Promise<boolean | undefined> {
    const [row] = await getDb()
      .select({ v: workspaces.aiRequiresProvenOrigin })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row?.v;
  }

  async function auditRows() {
    return getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, WS), eq(auditLogs.action, AI_ORIGIN_LOCK_AUDIT_ACTION)))
      .orderBy(desc(auditLogs.createdAt));
  }

  beforeAll(async () => {
    await getDb()
      .insert(workspaces)
      .values([
        { id: WS, name: 'F70S30 trava', slug: `f70s30-${sfx}` },
        { id: OTHER_WS, name: 'F70S30 outro', slug: `f70s30-ot-${sfx}` },
      ]);
    for (const role of ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'] as const) {
      cookies.set(role, await seedMember(WS, role, role.toLowerCase()));
    }
    otherOwnerCookie = await seedMember(OTHER_WS, 'OWNER', 'other-owner');
  });

  afterAll(async () => {
    await getDb().delete(workspaces).where(inArray(workspaces.id, [WS, OTHER_WS]));
    await closeDb();
  });

  it('sem sessão → 401', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
    expect((await request(app).patch(PATH).send({ aiRequiresProvenOrigin: false })).status).toBe(
      401,
    );
  });

  it('workspace novo nasce com a trava LIGADA (fail-closed)', async () => {
    expect(await lockValue()).toBe(true);
    const res = await as('OWNER').get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiRequiresProvenOrigin: true, lastChange: null });
  });

  it.each(['SUPERVISOR', 'AGENT', 'READONLY'] as const)(
    '%s não lê nem altera (403) e nada muda',
    async (role) => {
      expect((await as(role).get()).status).toBe(403);
      expect((await as(role).patch({ aiRequiresProvenOrigin: false })).status).toBe(403);
      expect(await lockValue()).toBe(true);
      expect(await auditRows()).toHaveLength(0);
    },
  );

  it('payload inválido → 400 (booleano estrito, sem campo extra)', async () => {
    for (const body of [
      {},
      { aiRequiresProvenOrigin: 'false' },
      { aiRequiresProvenOrigin: 0 },
      { aiRequiresProvenOrigin: false, extra: 1 },
    ]) {
      expect((await as('OWNER').patch(body)).status).toBe(400);
    }
    expect(await lockValue()).toBe(true);
  });

  it('ADMIN desliga: grava e audita quem, quando, anterior e novo', async () => {
    const before = Date.now();
    const res = await as('ADMIN').patch({ aiRequiresProvenOrigin: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiRequiresProvenOrigin: false, changed: true, previous: true });
    expect(await lockValue()).toBe(false);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.actorMemberId).toBe(memberIds.get('ADMIN'));
    expect(row?.actorType).toBe('member');
    expect(row?.resourceType).toBe('workspace');
    expect(row?.resourceId).toBe(WS);
    expect(row?.metadata).toEqual({ previous: true, next: false });
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);

    const view = await as('ADMIN').get();
    expect(view.body).toMatchObject({
      aiRequiresProvenOrigin: false,
      lastChange: { byName: 'F70S30 admin', previous: true, next: false },
    });
  });

  it('pedido sem mudança não audita (changed: false)', async () => {
    const res = await as('OWNER').patch({ aiRequiresProvenOrigin: false });
    expect(res.body).toEqual({ aiRequiresProvenOrigin: false, changed: false, previous: false });
    expect(await auditRows()).toHaveLength(1);
  });

  it('OWNER religa: nova linha de auditoria com o valor anterior', async () => {
    const res = await as('OWNER').patch({ aiRequiresProvenOrigin: true });
    expect(res.body).toEqual({ aiRequiresProvenOrigin: true, changed: true, previous: false });
    expect(await lockValue()).toBe(true);
    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.actorMemberId).toBe(memberIds.get('OWNER'));
    expect(rows[0]?.metadata).toEqual({ previous: false, next: true });
  });

  it('OWNER de outro workspace só altera o próprio (RLS)', async () => {
    const res = await request(app)
      .patch(PATH)
      .set('Cookie', otherOwnerCookie)
      .send({ aiRequiresProvenOrigin: false });
    expect(res.status).toBe(200);
    expect(await lockValue(OTHER_WS)).toBe(false);
    expect(await lockValue(WS)).toBe(true);
    expect(await auditRows()).toHaveLength(2);
  });

  it('PATCH /api/workspace não aceita a trava (só a rota auditada muda)', async () => {
    const res = await request(app)
      .patch('/api/workspace')
      .set('Cookie', cookies.get('OWNER') ?? '')
      .send({ aiRequiresProvenOrigin: false });
    expect(res.status).toBe(400);
    expect(await lockValue()).toBe(true);
  });
});
