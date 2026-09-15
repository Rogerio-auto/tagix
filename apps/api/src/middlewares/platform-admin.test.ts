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
import {
  createPlatformAdminGuard,
  requirePlatformAdmin,
  type DeniedAccessWriter,
  type PlatformAdminGuardDeps,
} from './platform-admin';

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

    // Sem espera de propósito (F25-S10): a auditoria é gravada ANTES do 403. Uma espera aqui
    // escondia exatamente a corrida que deixava tentativa negada sem registro.
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

/**
 * F25-S10 — a ordem e a falha da gravação, sem depender da velocidade do banco.
 *
 * Contra o Postgres local a gravação quase sempre termina antes de o teste consultar, então a
 * corrida não aparece (10 de 10 passavam antes da correção). Um gravador lento e um que falha
 * tornam as duas garantias determinísticas.
 */
describe('F25-S10 — tentativa negada registrada antes do 403', () => {
  function appCom(deps: PlatformAdminGuardDeps): express.Express {
    const a = express();
    a.get('/platform/ping', ...createPlatformAdminGuard(deps), (_req, res) => {
      res.json({ ok: true });
    });
    return a;
  }

  it('o 403 só sai depois de a gravação terminar', async () => {
    let gravadoEm = 0;
    const lento: DeniedAccessWriter = async () => {
      await new Promise((r) => setTimeout(r, 200));
      gravadoEm = Date.now();
    };
    const res = await request(appCom({ writeDenied: lento })).get('/platform/ping').set('Cookie', userCookie);
    const respondidoEm = Date.now();
    expect(res.status).toBe(403);
    expect(gravadoEm).toBeGreaterThan(0);
    expect(gravadoEm).toBeLessThanOrEqual(respondidoEm);
  });

  it('falha na gravação não derruba a negação e fica no log', async () => {
    const erros: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger = {
      error: (msg: string, meta?: Record<string, unknown>) => {
        erros.push({ msg, meta });
      },
    };
    const falha: DeniedAccessWriter = async () => {
      throw new Error('audit_logs indisponível');
    };
    const res = await request(appCom({ writeDenied: falha, logger }))
      .get('/platform/ping')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
    expect(erros).toHaveLength(1);
    expect(erros[0]?.msg).toBe('platform.access_denied.audit_failed');
    expect(erros[0]?.meta).toMatchObject({ memberId: userMemberId, error: 'audit_logs indisponível' });
  });
});
