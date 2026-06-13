/**
 * F26-S05 -- middleware de impersonation (view-as READ-ONLY). PROVA as invariantes:
 * le o tenant alvo em GET, bloqueia toda escrita (403), nega platform/secret routes,
 * recusa claim que nao bate com a sessao, e e no-op sem claim valido.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, impersonationSessionsRepo, schema } from '@hm/db';
import { SESSION_COOKIE } from '../auth/session';
import { requireAuth } from './auth';
import { IMPERSONATION_COOKIE, impersonationMiddleware } from './impersonation';

const { workspaces, members } = schema;

let wsAdmin = '';
let wsTarget = '';
let adminMemberId = '';
let adminCookie = '';
let userCookie = '';
const sfx = randomUUID().slice(0, 8);

// App de teste: authenticate -> impersonation -> rota que ecoa o workspace do contexto.
const app = express();
app.use(express.json());
app.use(requireAuth);
app.use(impersonationMiddleware);
app.get('/echo', (req: Request, res: Response) => {
  res.json({ workspaceId: req.auth?.workspace.id, impersonating: req.impersonation?.targetWorkspaceId ?? null });
});
app.post('/write', (_req: Request, res: Response) => res.json({ ok: true }));
app.get('/api/platform/anything', (_req: Request, res: Response) => res.json({ ok: true }));
app.get('/api/channels/secret', (_req: Request, res: Response) => res.json({ ok: true }));

const cookieFor = (a: string, e: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(
    Buffer.from(JSON.stringify({ authUserId: a, email: e, iat: Date.now() })).toString('base64url'),
  )}`;

beforeAll(async () => {
  const db = getDb();
  const [wa] = await db
    .insert(workspaces)
    .values({ name: `ImpAdminWS ${sfx}`, slug: `imp-admin-${sfx}` })
    .returning();
  const [wt] = await db
    .insert(workspaces)
    .values({ name: `ImpTargetWS ${sfx}`, slug: `imp-target-${sfx}` })
    .returning();
  wsAdmin = wa!.id;
  wsTarget = wt!.id;

  const aAuth = randomUUID();
  const aEmail = `impadmin-${sfx}@t.local`;
  const [am] = await db
    .insert(members)
    .values({
      workspaceId: wsAdmin,
      authUserId: aAuth,
      email: aEmail,
      role: 'OWNER',
      status: 'active',
      isPlatformAdmin: true,
    })
    .returning();
  adminMemberId = am!.id;
  adminCookie = cookieFor(aAuth, aEmail);

  // Member NAO-admin (para o caso de claim com member errado).
  const uAuth = randomUUID();
  const uEmail = `impuser-${sfx}@t.local`;
  await db
    .insert(members)
    .values({ workspaceId: wsAdmin, authUserId: uAuth, email: uEmail, role: 'AGENT', status: 'active' });
  userCookie = cookieFor(uAuth, uEmail);
});

afterAll(async () => {
  const db = getDb();
  if (wsAdmin) await db.delete(workspaces).where(eq(workspaces.id, wsAdmin));
  if (wsTarget) await db.delete(workspaces).where(eq(workspaces.id, wsTarget));
  await closeDb();
});

async function makeSession(opts?: { expired?: boolean }) {
  const expiresAt = new Date(Date.now() + (opts?.expired ? -1000 : 30 * 60 * 1000));
  return impersonationSessionsRepo.create({
    adminMemberId,
    targetWorkspaceId: wsTarget,
    reason: 'suporte: investigar bug do tenant',
    expiresAt,
  });
}
const impCookie = (id: string) => `${IMPERSONATION_COOKIE}=${id}`;

describe('no-op sem claim', () => {
  it('sem cookie de impersonation -> contexto normal (workspace do admin)', async () => {
    const res = await request(app).get('/echo').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(wsAdmin);
    expect(res.body.impersonating).toBeNull();
  });

  it('claim invalido (id inexistente) -> no-op', async () => {
    const res = await request(app)
      .get('/echo')
      .set('Cookie', `${adminCookie}; ${impCookie(randomUUID())}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(wsAdmin);
  });

  it('sessao expirada -> no-op (volta ao normal)', async () => {
    const s = await makeSession({ expired: true });
    const res = await request(app)
      .get('/echo')
      .set('Cookie', `${adminCookie}; ${impCookie(s.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(wsAdmin);
  });
});

describe('view-as ativo (read-only)', () => {
  it('GET le o workspace ALVO (contexto sobreposto)', async () => {
    const s = await makeSession();
    const res = await request(app)
      .get('/echo')
      .set('Cookie', `${adminCookie}; ${impCookie(s.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(wsTarget);
    expect(res.body.impersonating).toBe(wsTarget);
  });

  it('POST (escrita) -> 403 read-only', async () => {
    const s = await makeSession();
    const res = await request(app)
      .post('/write')
      .set('Cookie', `${adminCookie}; ${impCookie(s.id)}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('impersonation_read_only');
  });

  it('rota de plataforma -> 403 forbidden_route', async () => {
    const s = await makeSession();
    const res = await request(app)
      .get('/api/platform/anything')
      .set('Cookie', `${adminCookie}; ${impCookie(s.id)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('impersonation_forbidden_route');
  });

  it('rota de secret -> 403 forbidden_route', async () => {
    const s = await makeSession();
    const res = await request(app)
      .get('/api/channels/secret')
      .set('Cookie', `${adminCookie}; ${impCookie(s.id)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('impersonation_forbidden_route');
  });
});

describe('anti-tampering', () => {
  it('claim de admin valido usado por OUTRO member -> 403 rejected', async () => {
    const s = await makeSession();
    const res = await request(app)
      .get('/echo')
      .set('Cookie', `${userCookie}; ${impCookie(s.id)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('impersonation_claim_rejected');
  });
});
