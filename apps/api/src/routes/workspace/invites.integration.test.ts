/**
 * F71-S05 — convites de ponta a ponta contra o Postgres dev, com o MockAuthProvider real
 * (`getAuthProvider()` sem Supabase configurado): a caixa de saída do mock entrega o link
 * que o email levaria — o token do convite no caminho e a prova de posse da caixa
 * (`token_hash`) no fragmento —, então o que os aceites usam é exatamente o que o email levaria.
 *
 * App montado como em produção, na ordem relevante: router público de convite, guard de
 * UUID (`/api/members/invites` precisa passar por ele), `/api/me/invites` e as rotas de
 * workspace. Os loggers dos dois routers e o console são capturados para provar que o token
 * em claro nunca é logado.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, hashInviteToken, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import { AuthError, type Role } from '@hm/shared';
import { getAuthProvider } from '../../auth/provider';
import { MockAuthProvider } from '../../auth/mock-provider';
import { resolveSessionStatus, SESSION_COOKIE, WORKSPACE_COOKIE } from '../../auth/session';
import { createInviteAuthRouter } from '../../auth/invite';
import { closeRateLimit } from '../../middlewares/rate-limit';
import { uuidParamGuard } from '../../middlewares/uuid-params';
import { createInvitesMeRouter } from '../members/invites-me';
import { closeInviteQuota, createInviteSendQuota } from './invite-quota';
import { createInvitesRouter, INVITE_AUDIT_ACTIONS, MAX_INVITE_SENDS } from './invites';
import { createWorkspaceRouter } from './workspace';

const { workspaces, members, memberInvites, auditLogs, workspaceEntitlementOverrides } = schema;

const url = process.env['DATABASE_URL'];
const provider = getAuthProvider();
const isMock = provider instanceof MockAuthProvider;

// ─── Captura de log ───────────────────────────────────────────────────────────
const captured: string[] = [];
const sink = { write: (line: string) => void captured.push(line) };
const logger = createLogger('debug', { test: 'f71-s05' }, { destination: sink });

const run = randomUUID().slice(0, 8);
// Uma cota só para as rotas do admin e a pública (como em produção: mesmos contadores).
const quota = createInviteSendQuota({ prefix: `invq-it-${run}` });
const app = express();
app.use(express.json());
app.use(
  createInviteAuthRouter({
    logger,
    quota,
    limits: {
      preview: { bucket: `invite_preview_it_${run}`, max: 10_000, windowSec: 600 },
      accept: { bucket: `invite_accept_it_${run}`, max: 10_000, windowSec: 600 },
      sendEmail: { bucket: `invite_send_it_${run}`, max: 10_000, windowSec: 600 },
    },
  }),
);
app.use(uuidParamGuard);
app.use(createInvitesMeRouter());
app.use(createInvitesRouter({ logger, quota }));
app.use(createWorkspaceRouter());

function mockCookie(authUserId: string, email: string): string {
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

describe.skipIf(!url || !isMock)('convites (F71-S05) — integração', () => {
  const mock = provider as MockAuthProvider;
  const WS_A = randomUUID();
  const WS_B = randomUUID();
  const sfx = WS_A.slice(0, 8);
  const email = (tag: string) => `f71s05-${tag}-${sfx}@t.local`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const tokens: string[] = [];
  const proofs: string[] = [];
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  async function seed(
    workspaceId: string,
    role: Role,
    tag: string,
    status = 'active',
  ): Promise<{ id: string; authUserId: string; email: string }> {
    const authUserId = randomUUID();
    const mail = email(tag);
    const [m] = await getDb()
      .insert(members)
      .values({ workspaceId, authUserId, email: mail, name: `F71S05 ${tag}`, role, status })
      .returning({ id: members.id });
    if (!m) throw new Error('member');
    cookies.set(tag, mockCookie(authUserId, mail));
    ids.set(tag, m.id);
    return { id: m.id, authUserId, email: mail };
  }

  function as(tag: string) {
    const cookie = cookies.get(tag);
    if (!cookie) throw new Error(`sem sessão ${tag}`);
    return {
      get: (path: string) => request(app).get(path).set('Cookie', cookie),
      post: (path: string, body: object = {}) => request(app).post(path).set('Cookie', cookie).send(body),
      patch: (path: string, body: object) => request(app).patch(path).set('Cookie', cookie).send(body),
      del: (path: string) => request(app).delete(path).set('Cookie', cookie),
    };
  }

  /**
   * Último email da caixa de saída do mock para este endereço: o token do convite (caminho)
   * e a prova de posse da caixa (fragmento `#token_hash=…&type=…`), lidos do link do botão.
   */
  function lastEmailFor(address: string): {
    kind: string;
    token: string;
    proof: { tokenHash: string; type: 'invite' | 'magiclink' };
  } {
    const mail = [...mock.outbox].reverse().find((m) => m.email === address.toLowerCase());
    if (!mail) throw new Error(`nenhum email para ${address}`);
    const link = new URL(mail.link);
    const token = link.pathname.split('/').pop() ?? '';
    // A prova vai no fragmento (nunca na query): nada dela chega a log de servidor.
    expect(link.search).toBe('');
    const fragment = new URLSearchParams(link.hash.slice(1));
    const tokenHash = fragment.get('token_hash') ?? '';
    const type = fragment.get('type') === 'invite' ? 'invite' : 'magiclink';
    tokens.push(token);
    proofs.push(tokenHash);
    return { kind: mail.kind, token, proof: { tokenHash, type } };
  }

  const outboxFor = (address: string) =>
    mock.outbox.filter((m) => m.email === address.toLowerCase()).length;

  async function inviteRow(inviteId: string) {
    const [row] = await getDb().select().from(memberInvites).where(eq(memberInvites.id, inviteId));
    return row;
  }

  async function makeResendable(inviteId: string): Promise<void> {
    await getDb()
      .update(memberInvites)
      .set({ lastSentAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(memberInvites.id, inviteId));
  }

  async function auditCount(action: string, resourceId: string): Promise<number> {
    const rows = await getDb()
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), eq(auditLogs.resourceId, resourceId)));
    return rows.length;
  }

  const preview = (token: string) => request(app).post('/auth/invite/preview').send({ token });
  const sendEmail = (token: string) => request(app).post('/auth/invite/send-email').send({ token });
  const accept = (body: object, cookie?: string) => {
    const r = request(app).post('/auth/invite/accept');
    return (cookie ? r.set('Cookie', cookie) : r).send(body);
  };

  beforeAll(async () => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const original = console[method].bind(console);
      consoleSpies.push(
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
          original(...args);
        }),
      );
    }
    await getDb()
      .insert(workspaces)
      .values([
        { id: WS_A, name: 'F71S05 Alfa', slug: `f71s05-a-${sfx}` },
        { id: WS_B, name: 'F71S05 Beta', slug: `f71s05-b-${sfx}` },
      ]);
    await seed(WS_A, 'OWNER', 'a-owner');
    await seed(WS_A, 'ADMIN', 'a-admin');
    await seed(WS_A, 'AGENT', 'a-agent');
    await seed(WS_B, 'ADMIN', 'b-admin');
    // Pessoa com conta (membro da B): o login no mock a registra como conta com senha.
    await seed(WS_B, 'AGENT', 'person');
    const session = await mock.signIn({ email: email('person'), password: 'irrelevante' });
    cookies.set('person', `${SESSION_COOKIE}=${encodeURIComponent(session.accessToken)}`);
  });

  afterAll(async () => {
    for (const spy of consoleSpies) spy.mockRestore();
    await getDb().delete(workspaces).where(inArray(workspaces.id, [WS_A, WS_B]));
    await closeRateLimit();
    await closeInviteQuota();
    await closeDb();
  });

  // ─── Autorização e validação ────────────────────────────────────────────────

  it('AGENT não lista nem convida (403); GET /api/members também exige member.invite', async () => {
    expect((await as('a-agent').get('/api/members/invites')).status).toBe(403);
    expect(
      (await as('a-agent').post('/api/members/invites', { email: email('x'), role: 'AGENT' })).status,
    ).toBe(403);
    expect((await as('a-agent').get('/api/members')).status).toBe(403);
    const list = await as('a-admin').get('/api/members');
    expect(list.status).toBe(200);
    expect(list.body.members[0]).toHaveProperty('legacyInvite', false);
  });

  it('convite OWNER → 400; papel desconhecido, email inválido e campo extra → 400', async () => {
    const owner = await as('a-owner').post('/api/members/invites', { email: email('o'), role: 'OWNER' });
    expect(owner.status).toBe(400);
    expect(owner.body.error).toBe('owner_not_invitable');
    expect(
      (await as('a-owner').post('/api/members/invites', { email: email('o'), role: 'GOD' })).body.error,
    ).toBe('invalid_role');
    expect((await as('a-owner').post('/api/members/invites', { email: 'nope', role: 'AGENT' })).status).toBe(400);
    expect(
      (await as('a-owner').post('/api/members/invites', { email: email('o'), role: 'AGENT', x: 1 })).status,
    ).toBe(400);
    expect(
      (
        await as('a-owner').post('/api/members/invites', {
          email: email('o'),
          role: 'AGENT',
          departmentId: randomUUID(),
        })
      ).body.error,
    ).toBe('invalid_department');
  });

  it('email de membro ativo → 409 already_member', async () => {
    const res = await as('a-admin').post('/api/members/invites', {
      email: email('a-agent').toUpperCase(),
      role: 'AGENT',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_member');
  });

  it('POST /api/members legado → 410 apontando o substituto, sem criar nada', async () => {
    const res = await as('a-admin').post('/api/members', { email: email('legacy'), role: 'AGENT' });
    expect(res.status).toBe(410);
    expect(res.body.replacement).toBe('/api/members/invites');
    const rows = await getDb().select().from(members).where(eq(members.email, email('legacy')));
    expect(rows).toHaveLength(0);
  });

  // ─── Sem conta: convite → aceite → login ────────────────────────────────────

  it('convite → aceite sem conta → login → membro ativo com authUserId real e papel do convite', async () => {
    const invitee = email('new');
    const created = await as('a-admin').post('/api/members/invites', { email: invitee, role: 'SUPERVISOR' });
    expect(created.status).toBe(201);
    expect(created.body.delivery).toBe('sent');
    expect(created.body.invite).toMatchObject({ email: invitee, role: 'SUPERVISOR', sendCount: 1 });
    expect(JSON.stringify(created.body)).not.toMatch(/token/i);

    const mail = lastEmailFor(invitee);
    expect(mail.kind).toBe('invite');
    const row = await inviteRow(created.body.invite.id);
    expect(row?.tokenHash).toBe(hashInviteToken(mail.token));
    expect(row?.tokenHash).not.toBe(mail.token);
    expect(await auditCount(INVITE_AUDIT_ACTIONS.invited, created.body.invite.id)).toBe(1);

    expect(mail.proof.type).toBe('invite');

    const pv = await preview(mail.token);
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({
      workspaceName: 'F71S05 Alfa',
      inviterName: 'F71S05 a-admin',
      role: 'SUPERVISOR',
      requiresEmailProof: true,
    });
    expect(pv.body).not.toHaveProperty('hasAccount');
    expect(pv.body.emailMasked).toMatch(/^f7\*\*\*@t\.local$/);
    expect(pv.headers['cache-control']).toBe('no-store');
    expect(pv.headers['referrer-policy']).toBe('no-referrer');

    // Sem a prova do email: 403, mesmo com senha forte.
    const noProof = await accept({ token: mail.token, password: 'Senha-forte-123' });
    expect(noProof.status).toBe(403);
    expect(noProof.body.error).toBe('email_proof_required');
    // Senha validada ANTES de consumir a prova (uso único): erro de senha não a gasta.
    expect((await accept({ token: mail.token, emailProof: mail.proof })).body.error).toBe(
      'password_required',
    );
    expect(
      (await accept({ token: mail.token, password: 'curta1', emailProof: mail.proof })).body.error,
    ).toBe('weak_password');
    expect(
      (
        await accept({
          token: mail.token,
          password: 'Senha-forte-123',
          emailProof: mail.proof,
          role: 'OWNER',
        })
      ).status,
    ).toBe(400);

    const ok = await accept({
      token: mail.token,
      password: 'Senha-forte-123',
      name: 'Nova Pessoa',
      emailProof: mail.proof,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ next: `/login?email=${encodeURIComponent(invitee)}` });
    expect(ok.headers['set-cookie']).toBeUndefined(); // sem auto-login (§3.5)

    const account = await mock.findUserByEmail(invitee);
    expect(account).toMatchObject({ emailConfirmed: true, hasPassword: true });
    const [member] = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, WS_A), eq(members.email, invitee)));
    expect(member).toMatchObject({
      status: 'active',
      role: 'SUPERVISOR',
      authUserId: account?.authUserId,
      name: 'Nova Pessoa',
    });
    expect(await auditCount(INVITE_AUDIT_ACTIONS.joined, created.body.invite.id)).toBe(1);

    // Login: a pessoa entra e a sessão resolve a empresa do convite.
    const session = await mock.signIn({ email: invitee, password: 'Senha-forte-123' });
    const resolved = await resolveSessionStatus(session.accessToken);
    expect(resolved.kind).toBe('ok');
    if (resolved.kind === 'ok') {
      expect(resolved.session.workspace.id).toBe(WS_A);
      expect(resolved.session.member.role).toBe('SUPERVISOR');
    }

    // Token reusado → 404 uniforme no preview e no aceite.
    const again = await preview(mail.token);
    const reaccept = await accept({
      token: mail.token,
      password: 'Senha-forte-123',
      emailProof: mail.proof,
    });
    expect(again.status).toBe(404);
    expect(reaccept.status).toBe(404);
    expect(reaccept.body).toEqual(again.body);
  });

  it('404 uniforme: malformado, inexistente, expirado e revogado têm a mesma resposta', async () => {
    const malformed = await preview('x');
    const unknown = await preview(Buffer.alloc(32, 7).toString('base64url'));
    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(malformed.body);

    // Expirado.
    const exp = await as('a-admin').post('/api/members/invites', { email: email('exp'), role: 'AGENT' });
    const expToken = lastEmailFor(email('exp')).token;
    await getDb()
      .update(memberInvites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(memberInvites.id, exp.body.invite.id));
    const expPv = await preview(expToken);
    const expAc = await accept({ token: expToken, password: 'Senha-forte-123' });
    expect(expPv.status).toBe(404);
    expect(expAc.status).toBe(404);
    expect(expPv.body).toEqual(malformed.body);
    expect(expAc.body).toEqual(malformed.body);
    // A lista do admin mostra o vencido para reenviar.
    const list = await as('a-admin').get('/api/members/invites');
    expect(list.body.invites.find((i: { id: string }) => i.id === exp.body.invite.id)?.expired).toBe(true);

    // Revogado.
    const rev = await as('a-admin').post('/api/members/invites', { email: email('rev'), role: 'AGENT' });
    const revToken = lastEmailFor(email('rev')).token;
    expect((await preview(revToken)).status).toBe(200);
    expect((await as('a-admin').del(`/api/members/invites/${rev.body.invite.id}`)).status).toBe(204);
    expect(await auditCount(INVITE_AUDIT_ACTIONS.revoked, rev.body.invite.id)).toBe(1);
    const revPv = await preview(revToken);
    expect(revPv.status).toBe(404);
    expect(revPv.body).toEqual(malformed.body);
    expect((await accept({ token: revToken, password: 'Senha-forte-123' })).status).toBe(404);
    // Revogar de novo → 404.
    expect((await as('a-admin').del(`/api/members/invites/${rev.body.invite.id}`)).status).toBe(404);
  });

  // ─── Reenvio e copiar link ──────────────────────────────────────────────────

  it('reenviar invalida o token anterior; 1/min; teto de envios; convite repetido reenvia', async () => {
    const addr = email('resend');
    const created = await as('a-admin').post('/api/members/invites', { email: addr, role: 'READONLY' });
    const id: string = created.body.invite.id;
    const first = lastEmailFor(addr).token;

    const tooSoon = await as('a-admin').post(`/api/members/invites/${id}/resend`);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toBe('resend_cooldown');
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);

    await makeResendable(id);
    const resent = await as('a-admin').post(`/api/members/invites/${id}/resend`);
    expect(resent.status).toBe(200);
    expect(resent.body.invite.sendCount).toBe(2);
    const second = lastEmailFor(addr).token;
    expect(second).not.toBe(first);
    expect((await preview(first)).status).toBe(404);
    expect((await preview(second)).status).toBe(200);
    expect(await auditCount(INVITE_AUDIT_ACTIONS.resent, id)).toBe(1);

    // POST com o mesmo email: reenvia em vez de duplicar.
    await makeResendable(id);
    const dup = await as('a-admin').post('/api/members/invites', { email: addr, role: 'ADMIN' });
    expect(dup.status).toBe(200);
    expect(dup.body).toMatchObject({ resent: true, invite: { id, role: 'READONLY', sendCount: 3 } });
    expect((await preview(second)).status).toBe(404);

    // Teto: 6 envios (1 + 5 reenvios).
    await getDb()
      .update(memberInvites)
      .set({ sendCount: MAX_INVITE_SENDS, lastSentAt: new Date(Date.now() - 120_000) })
      .where(eq(memberInvites.id, id));
    const capped = await as('a-admin').post(`/api/members/invites/${id}/resend`);
    expect(capped.status).toBe(429);
    expect(capped.body.error).toBe('send_limit');
  });

  it('copiar link (POST): token novo, link anterior morre, auditado, no-store', async () => {
    const addr = email('link');
    const created = await as('a-admin').post('/api/members/invites', { email: addr, role: 'AGENT' });
    const id: string = created.body.invite.id;
    const emailed = lastEmailFor(addr).token;

    const link = await as('a-admin').post(`/api/members/invites/${id}/link`);
    expect(link.status).toBe(200);
    expect(link.headers['cache-control']).toBe('no-store');
    expect(link.headers['referrer-policy']).toBe('no-referrer');
    const copied = new URL(link.body.url as string).pathname.split('/').pop() ?? '';
    tokens.push(copied);
    expect(link.body.url).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
    expect((await preview(emailed)).status).toBe(404);
    expect((await preview(copied)).status).toBe(200);
    expect(await auditCount(INVITE_AUDIT_ACTIONS.linkCopied, id)).toBe(1);

    // Id malformado e id alheio → 404.
    expect((await as('a-admin').post('/api/members/invites/nao-uuid/link')).status).toBe(404);
    expect((await as('a-admin').post(`/api/members/invites/${randomUUID()}/link`)).status).toBe(404);
  });

  // ─── Com conta ──────────────────────────────────────────────────────────────

  it('pessoa com conta: link de acesso; aceite exige a sessão do email convidado', async () => {
    const addr = email('person');
    const created = await as('a-admin').post('/api/members/invites', { email: addr, role: 'AGENT' });
    expect(created.status).toBe(201);
    const mail = lastEmailFor(addr);
    expect(mail.kind).toBe('sign_in_link');

    const pv = await preview(mail.token);
    expect(pv.body.requiresEmailProof).toBe(false);

    // Banner: o convite aparece para a sessão da pessoa, sem token.
    const banner = await as('person').get('/api/me/invites');
    expect(banner.status).toBe(200);
    const mine = banner.body.invites.find((i: { workspaceId: string }) => i.workspaceId === WS_A);
    expect(mine).toMatchObject({ workspaceName: 'F71S05 Alfa', role: 'AGENT' });
    expect(Object.keys(mine as object).sort()).toEqual(
      ['expiresAt', 'id', 'inviterName', 'role', 'workspaceId', 'workspaceName'].sort(),
    );

    const complete = vi.spyOn(mock, 'completeAccount');
    // Sem sessão: nem com senha o link define a senha de quem já tem conta (anti-takeover).
    const anon = await accept({ token: mail.token, password: 'Senha-do-invasor-9' });
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe('login_required');
    // Sessão de outra pessoa → 403 wrong_account.
    const wrong = await accept({ token: mail.token }, cookies.get('b-admin'));
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe('wrong_account');
    expect(complete).not.toHaveBeenCalled();
    complete.mockRestore();

    // F-16: os dois aceites negados deixam trilha interna, sem token nem email completo.
    const inviteId: string = created.body.invite.id;
    expect(await auditCount(INVITE_AUDIT_ACTIONS.acceptDenied, inviteId)).toBe(2);
    const denied = await getDb()
      .select({ actorType: auditLogs.actorType, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, INVITE_AUDIT_ACTIONS.acceptDenied), eq(auditLogs.resourceId, inviteId)),
      );
    expect(denied.map((r) => r.actorType)).toEqual(['system', 'system']);
    expect(denied.map((r) => (r.metadata as { reason: string }).reason).sort()).toEqual([
      'login_required',
      'wrong_account',
    ]);
    const blob = JSON.stringify(denied);
    expect(blob).not.toContain(addr);
    expect(blob).not.toContain(mail.token);

    const ok = await accept({ token: mail.token, password: 'ignorada-123' }, cookies.get('person'));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ next: '/' });
    const setCookie = String(ok.headers['set-cookie'] ?? '');
    expect(setCookie).toContain(`${WORKSPACE_COOKIE}=${WS_A}`);
    expect(setCookie).toMatch(/HttpOnly/i);

    const account = await mock.findUserByEmail(addr);
    const [member] = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, WS_A), eq(members.email, addr)));
    expect(member).toMatchObject({ status: 'active', role: 'AGENT', authUserId: account?.authUserId });
    expect(await auditCount(INVITE_AUDIT_ACTIONS.joined, created.body.invite.id)).toBe(1);

    // Aceito: some do banner.
    const after = await as('person').get('/api/me/invites');
    expect(after.body.invites.some((i: { workspaceId: string }) => i.workspaceId === WS_A)).toBe(false);
  });

  it('cadastro não confirmado (tem senha do dono) conta como "tem conta": o link não troca a senha', async () => {
    const addr = email('pending-signup');
    await mock.signUp({ email: addr, password: 'Senha-do-dono-1' });
    const created = await as('a-admin').post('/api/members/invites', { email: addr, role: 'AGENT' });
    expect(created.status).toBe(201);
    const mail = lastEmailFor(addr);
    expect((await preview(mail.token)).body.requiresEmailProof).toBe(false);
    const complete = vi.spyOn(mock, 'completeAccount');
    // Nem com a prova do email: conta com senha do dono só aceita logada.
    const res = await accept({
      token: mail.token,
      password: 'Senha-do-invasor-9',
      emailProof: mail.proof,
    });
    expect(res.status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
    complete.mockRestore();
    expect(await mock.findUserByEmail(addr)).toMatchObject({ emailConfirmed: false });
  });

  it('envio falhou → link copiado NÃO cria conta; send-email manda a prova e só o dono da caixa aceita', async () => {
    const addr = email('nodelivery');
    const send = vi
      .spyOn(mock, 'sendInvite')
      .mockRejectedValueOnce(new AuthError('smtp fora', 'provider_error'));
    const before = captured.length;
    const created = await as('a-admin').post('/api/members/invites', { email: addr, role: 'AGENT' });
    send.mockRestore();
    expect(created.status).toBe(201);
    expect(created.body.delivery).toBe('failed');
    expect(captured.slice(before).join('\n')).toContain('member_invite_delivery_failed');
    expect(await mock.findUserByEmail(addr)).toBeNull();

    const link = await as('a-admin').post(`/api/members/invites/${created.body.invite.id}/link`);
    const token = new URL(link.body.url as string).pathname.split('/').pop() ?? '';
    tokens.push(token);
    expect((await preview(token)).body.requiresEmailProof).toBe(true);

    // Quem tem só o link (o admin que copiou, por exemplo) não cria a conta nem entra.
    const signUp = vi.spyOn(mock, 'signUp');
    const complete = vi.spyOn(mock, 'completeAccount');
    const hostile = await accept({ token, password: 'Senha-do-admin-9' });
    expect(hostile.status).toBe(403);
    expect(hostile.body).toEqual({
      error: 'email_proof_required',
      message: 'Abra o link que enviamos para o email convidado para criar a sua senha.',
    });
    // Prova inventada → o mesmo 403.
    const forged = await accept({
      token,
      password: 'Senha-do-admin-9',
      emailProof: { tokenHash: 'f'.repeat(56), type: 'invite' },
    });
    expect(forged.status).toBe(403);
    expect(forged.body).toEqual(hostile.body);
    expect(signUp).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(await mock.findUserByEmail(addr)).toBeNull();
    const noMember = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, WS_A), eq(members.email, addr)));
    expect(noMember).toHaveLength(0);

    // A página pede o email: vai para o endereço DO CONVITE, com o MESMO token e a prova.
    const sent = await sendEmail(token);
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ ok: true, emailMasked: 'f7***@t.local' });
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['referrer-policy']).toBe('no-referrer');
    const mail = lastEmailFor(addr);
    expect(mail.kind).toBe('invite');
    expect(mail.token).toBe(token);
    expect(await auditCount(INVITE_AUDIT_ACTIONS.emailRequested, created.body.invite.id)).toBe(1);
    // Cooldown por convite.
    const tooSoon = await sendEmail(token);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toBe('send_cooldown');
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);
    // A conta nasceu sem senha (claimable): o link continua exigindo a prova.
    expect(await mock.findUserByEmail(addr)).toMatchObject({ hasPassword: false });
    expect((await accept({ token, password: 'Senha-do-admin-9' })).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();

    const ok = await accept({ token, password: 'Senha-forte-123', emailProof: mail.proof });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ next: `/login?email=${encodeURIComponent(addr)}` });
    expect(signUp).not.toHaveBeenCalled();
    signUp.mockRestore();
    complete.mockRestore();
    const account = await mock.findUserByEmail(addr);
    expect(account).toMatchObject({ emailConfirmed: true, hasPassword: true });
    const [member] = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, WS_A), eq(members.email, addr)));
    expect(member?.authUserId).toBe(account?.authUserId);
  });

  it('conta claimable de OUTRA empresa: link copiado sem prova, prova de outra caixa ou reusada → 403', async () => {
    const victim = email('claimable');
    const other = email('other-mailbox');
    // A empresa B convida a vítima: a conta nasce sem senha (claimable).
    const fromB = await as('b-admin').post('/api/members/invites', { email: victim, role: 'AGENT' });
    expect(fromB.status).toBe(201);
    const mailB = lastEmailFor(victim);
    expect(await mock.findUserByEmail(victim)).toMatchObject({ hasPassword: false });

    // A empresa A (admin hostil) convida o mesmo email e copia o link.
    const fromA = await as('a-admin').post('/api/members/invites', { email: victim, role: 'AGENT' });
    expect(fromA.status).toBe(201);
    const copiedA = await as('a-admin').post(`/api/members/invites/${fromA.body.invite.id}/link`);
    const tokenA = new URL(copiedA.body.url as string).pathname.split('/').pop() ?? '';
    tokens.push(tokenA);

    const complete = vi.spyOn(mock, 'completeAccount');
    const noProof = await accept({ token: tokenA, password: 'Senha-do-admin-9' });
    expect(noProof.status).toBe(403);
    expect(noProof.body.error).toBe('email_proof_required');

    // Prova válida, mas de OUTRA caixa (o admin controla essa): 403.
    const otherInvite = await as('a-admin').post('/api/members/invites', { email: other, role: 'AGENT' });
    expect(otherInvite.status).toBe(201);
    const otherMail = lastEmailFor(other);
    const wrongBox = await accept({
      token: tokenA,
      password: 'Senha-do-admin-9',
      emailProof: otherMail.proof,
    });
    expect(wrongBox.status).toBe(403);
    expect(wrongBox.body).toEqual(noProof.body);
    expect(complete).not.toHaveBeenCalled();
    expect(await mock.findUserByEmail(victim)).toMatchObject({ hasPassword: false });
    expect(await mock.findUserByEmail(other)).toMatchObject({ hasPassword: false });

    // Prova reusada: a de `other` foi consumida acima; nem o dono dela a usa de novo.
    const reused = await accept({
      token: otherMail.token,
      password: 'Senha-do-outro-1',
      emailProof: otherMail.proof,
    });
    expect(reused.status).toBe(403);
    expect(reused.body.error).toBe('email_proof_required');
    expect(complete).not.toHaveBeenCalled();

    // A vítima pede o email do convite da B e aceita com a prova da caixa dela.
    expect((await sendEmail(mailB.token)).status).toBe(200);
    const victimMail = lastEmailFor(victim);
    expect(victimMail.token).toBe(mailB.token);
    const okB = await accept({
      token: victimMail.token,
      password: 'Senha-da-vitima-1',
      emailProof: victimMail.proof,
    });
    expect(okB.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(1);
    complete.mockRestore();
    const [joinedB] = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, WS_B), eq(members.email, victim)));
    expect(joinedB?.status).toBe('active');

    // Agora a conta tem senha: o link da A só aceita logado (a prova nem é olhada).
    const later = await accept({
      token: tokenA,
      password: 'Senha-do-admin-9',
      emailProof: victimMail.proof,
    });
    expect(later.status).toBe(401);
    expect(await mock.verifyEmailOwnership(victimMail.proof.tokenHash, 'invite')).toBeNull();
    const notInA = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, WS_A), eq(members.email, victim)));
    expect(notInA).toHaveLength(0);
  });

  // ─── Assentos ───────────────────────────────────────────────────────────────

  it('max_members estourado → 402 (convite e reativação); sem limite = ilimitado', async () => {
    const list = await as('a-admin').get('/api/members/invites');
    const used: number = list.body.seats.used;
    expect(list.body.seats.limit).toBeNull();

    await getDb()
      .insert(workspaceEntitlementOverrides)
      .values({ workspaceId: WS_A, limits: { max_members: used } });

    const full = await as('a-admin').post('/api/members/invites', { email: email('seat'), role: 'AGENT' });
    expect(full.status).toBe(402);
    expect(full.body).toMatchObject({ error: 'seat_limit', used, limit: used });
    // O convite gravado para conferir o teto foi revogado: nada vivo para esse email.
    const live = await as('a-admin').get('/api/members/invites');
    expect(live.body.invites.some((i: { email: string }) => i.email === email('seat'))).toBe(false);
    expect(live.body.seats.used).toBe(used);

    // Reativação também ocupa assento.
    const removed = await seed(WS_A, 'AGENT', 'removed', 'inactive');
    const react = await as('a-admin').patch(`/api/members/${removed.id}`, { status: 'active' });
    expect(react.status).toBe(402);
    expect(react.body.error).toBe('seat_limit');

    // Linha `invited` nunca vira active pelo PATCH (só aceite/verify — T6).
    const legacy = await seed(WS_A, 'AGENT', 'legacy-invited', 'invited');
    expect((await as('a-admin').patch(`/api/members/${legacy.id}`, { status: 'active' })).body.error).toBe(
      'invite_pending',
    );

    await getDb()
      .update(workspaceEntitlementOverrides)
      .set({ limits: { max_members: used + 1 } })
      .where(eq(workspaceEntitlementOverrides.workspaceId, WS_A));
    expect((await as('a-admin').patch(`/api/members/${removed.id}`, { status: 'active' })).status).toBe(200);

    await getDb()
      .delete(workspaceEntitlementOverrides)
      .where(eq(workspaceEntitlementOverrides.workspaceId, WS_A));
  });

  // ─── RLS ────────────────────────────────────────────────────────────────────

  it('RLS: admin da B não lista, não reenvia, não copia link nem revoga convite da A', async () => {
    const created = await as('a-admin').post('/api/members/invites', { email: email('rls'), role: 'AGENT' });
    const id: string = created.body.invite.id;
    lastEmailFor(email('rls'));

    const listB = await as('b-admin').get('/api/members/invites');
    expect(listB.status).toBe(200);
    expect(listB.body.invites.some((i: { id: string }) => i.id === id)).toBe(false);
    await makeResendable(id);
    expect((await as('b-admin').post(`/api/members/invites/${id}/resend`)).status).toBe(404);
    expect((await as('b-admin').post(`/api/members/invites/${id}/link`)).status).toBe(404);
    expect((await as('b-admin').del(`/api/members/invites/${id}`)).status).toBe(404);

    const row = await inviteRow(id);
    expect(row?.revokedAt).toBeNull();
    expect(row?.sendCount).toBe(1);
  });

  it('cota no Redis: teto por empresa → 429 sem deixar convite; por destinatário → convite fica sem email', async () => {
    /** App só com as rotas do admin e uma cota de tetos baixos, isolada por prefixo. */
    function limitedApp(prefix: string, limits: { workspacePerHour?: number; recipientPerDay?: number }) {
      const limited = express();
      limited.use(express.json());
      limited.use(uuidParamGuard);
      limited.use(
        createInvitesRouter({
          logger,
          quota: createInviteSendQuota({ prefix: `${prefix}-${run}`, limits }),
        }),
      );
      return (tag: string, body: object) =>
        request(limited)
          .post('/api/members/invites')
          .set('Cookie', cookies.get(tag) ?? '')
          .send(body);
    }

    // Empresa: o 2º envio da hora estoura e o convite gravado é desfeito (nada foi enviado).
    const perWorkspace = limitedApp('invq-it-ws', { workspacePerHour: 1 });
    expect((await perWorkspace('b-admin', { email: email('flood-1'), role: 'AGENT' })).status).toBe(201);
    const flood = await perWorkspace('b-admin', { email: email('flood-2'), role: 'AGENT' });
    expect(flood.status).toBe(429);
    expect(flood.body.error).toBe('invite_rate_limited');
    expect(flood.headers['retry-after']).toBe('3600');
    const floodRows = await getDb()
      .select()
      .from(memberInvites)
      .where(eq(memberInvites.email, email('flood-2')));
    expect(floodRows.length).toBeGreaterThan(0);
    expect(floodRows.every((row) => row.revokedAt !== null)).toBe(true);
    expect(outboxFor(email('flood-2'))).toBe(0);

    // Destinatário (L2): a A manda 1; a B convida o mesmo endereço → o convite FICA, sem
    // email (`201 delivery: failed`, a mesma resposta do Redis fora — não revela que outra
    // empresa convidou). Uma empresa hostil que esgota a caixa não impede as outras de
    // convidar: o admin copia o link. Revogar e recriar não zera o teto (nenhum email sai).
    const perRecipient = limitedApp('invq-it-to', { recipientPerDay: 1 });
    const target = email('bombed');
    const first = await perRecipient('a-admin', { email: target, role: 'AGENT' });
    expect(first.status).toBe(201);
    expect(first.body.delivery).toBe('sent');
    const second = await perRecipient('b-admin', { email: target, role: 'AGENT' });
    expect(second.status).toBe(201);
    expect(second.body.delivery).toBe('failed');
    expect(second.headers['retry-after']).toBeUndefined();
    const kept = await inviteRow(second.body.invite.id as string);
    expect(kept?.revokedAt).toBeNull();
    expect(kept?.acceptedAt).toBeNull();
    const listedB = await as('b-admin').get('/api/members/invites');
    expect(
      (listedB.body.invites as Array<{ id: string }>).some((i) => i.id === second.body.invite.id),
    ).toBe(true);
    expect((await as('a-admin').del(`/api/members/invites/${first.body.invite.id as string}`)).status).toBe(204);
    const again = await perRecipient('a-admin', { email: target, role: 'AGENT' });
    expect(again.status).toBe(201);
    expect(again.body.delivery).toBe('failed');
    expect(outboxFor(target)).toBe(1);
  });

  // ─── B4: guard de UUID ──────────────────────────────────────────────────────

  it('PATCH/DELETE /api/members/invites e :id malformado → 404, nunca 500', async () => {
    expect((await as('a-owner').patch('/api/members/invites', { status: 'blocked' })).status).toBe(404);
    expect((await as('a-owner').del('/api/members/invites')).status).toBe(404);
    expect((await as('a-owner').patch('/api/members/nao-uuid', { status: 'blocked' })).status).toBe(404);
    expect((await as('a-admin').post('/api/members/invites/nao-uuid/resend')).status).toBe(404);
    expect((await as('a-admin').del('/api/members/invites/nao-uuid')).status).toBe(404);
    expect((await as('a-admin').get('/api/members/invites')).status).toBe(200);
  });

  // ─── B6: bloqueado não volta por convite ────────────────────────────────────

  it('bloqueado: convidar → 409; bloquear/remover revoga os pendentes; aceite de bloqueado → 409', async () => {
    const blocked = await seed(WS_A, 'AGENT', 'blk', 'blocked');
    const direct = await as('a-admin').post('/api/members/invites', { email: blocked.email, role: 'AGENT' });
    expect(direct.status).toBe(409);
    expect(direct.body.error).toBe('member_blocked');

    // Removido pode ser reconvidado; bloqueá-lo depois revoga o convite (auditado).
    const gone = await seed(WS_A, 'AGENT', 'gone', 'inactive');
    const inv = await as('a-admin').post('/api/members/invites', { email: gone.email, role: 'AGENT' });
    expect(inv.status).toBe(201);
    const goneToken = lastEmailFor(gone.email).token;
    expect((await as('a-owner').patch(`/api/members/${gone.id}`, { status: 'blocked' })).status).toBe(200);
    expect((await inviteRow(inv.body.invite.id as string))?.revokedAt).not.toBeNull();
    expect(await auditCount(INVITE_AUDIT_ACTIONS.revoked, inv.body.invite.id as string)).toBe(1);
    expect((await preview(goneToken)).status).toBe(404);

    // Remover (DELETE) também revoga.
    const leaving = await seed(WS_A, 'AGENT', 'leaving', 'inactive');
    const inv2 = await as('a-admin').post('/api/members/invites', { email: leaving.email, role: 'AGENT' });
    expect(inv2.status).toBe(201);
    lastEmailFor(leaving.email);
    expect((await as('a-owner').del(`/api/members/${leaving.id}`)).status).toBe(204);
    expect((await inviteRow(inv2.body.invite.id as string))?.revokedAt).not.toBeNull();
    expect(await auditCount(INVITE_AUDIT_ACTIONS.revoked, inv2.body.invite.id as string)).toBe(1);

    // Bloqueado por fora do fluxo, com o convite já vivo → o aceite recusa com 409.
    const late = await seed(WS_A, 'AGENT', 'late', 'inactive');
    const inv3 = await as('a-admin').post('/api/members/invites', { email: late.email, role: 'AGENT' });
    expect(inv3.status).toBe(201);
    const lateMail = lastEmailFor(late.email);
    await getDb().update(members).set({ status: 'blocked' }).where(eq(members.id, late.id));
    const complete = vi.spyOn(mock, 'completeAccount');
    const denied = await accept({
      token: lateMail.token,
      password: 'Senha-forte-123',
      emailProof: lateMail.proof,
    });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe('invite_conflict');
    expect(complete).not.toHaveBeenCalled();
    complete.mockRestore();
    const [row] = await getDb().select().from(members).where(eq(members.id, late.id));
    expect(row?.status).toBe('blocked');
    expect((await inviteRow(inv3.body.invite.id as string))?.acceptedAt).toBeNull();
  });

  // ─── Vazamento ──────────────────────────────────────────────────────────────

  it('token em claro (e o hash) nunca aparece no log nem na auditoria', async () => {
    expect(tokens.length).toBeGreaterThanOrEqual(8);
    expect(captured.length).toBeGreaterThan(0);
    const logText = captured.join('\n');
    const audit = await getDb()
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(inArray(auditLogs.workspaceId, [WS_A, WS_B]));
    const auditText = JSON.stringify(audit);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(logText).not.toContain(token);
      expect(auditText).not.toContain(token);
      expect(auditText).not.toContain(hashInviteToken(token));
    }
    // A prova de posse da caixa (token_hash) também não.
    expect(proofs.length).toBeGreaterThan(3);
    for (const proof of proofs) {
      expect(logText).not.toContain(proof);
      expect(auditText).not.toContain(proof);
    }
  });
});
