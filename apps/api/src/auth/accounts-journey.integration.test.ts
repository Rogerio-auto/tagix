/**
 * F71-S10 — jornada inteira de contas contra o Postgres/Redis dev, com o app REAL
 * (`createApp`) e o MockAuthProvider:
 *
 *  1. signup (termos) → verify → login → empresa A ativa; trial de 15 dias gravado;
 *  2. A convida B → B aceita sem conta (prova de posse da caixa vinda do outbox) → login de B;
 *  3. B faz o próprio signup → tem A e a própria → troca entre elas; dados isolados;
 *  4. remover B de A → cookie `hm_workspace` de A é ignorado; convite pendente revogado
 *     ao bloquear; verify não reativa removido;
 *  5. trial de A vence (tick real `expireTrials` do worker de cobrança) → A só leitura
 *     (escrita 402, leitura 200, billing e troca liberados); empresa própria de B segue plena.
 *
 * Mais bordas que o fluxo expõe: convite expirado/revogado/reusado, prova de outro email,
 * `max_members`, OWNER não convidável.
 *
 * Os `it` são sequenciais e compartilham estado (uma jornada). Dados únicos por execução
 * (emails/slugs com sufixo) e removidos no `afterAll`.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';

vi.stubEnv('AUTH_PROVIDER', 'mock');
vi.stubEnv('TURNSTILE_SECRET_KEY', '');
vi.stubEnv('AUTH_UNIFORM_RESPONSE_MS', '500');

const { createApp } = await import('../app');
const { mockVerifyToken, MockAuthProvider } = await import('./mock-provider');
const { getAuthProvider } = await import('./provider');
const { closeHealth } = await import('../health');
const { closeLoginCaptcha } = await import('./login-captcha');
const { closeRateLimit } = await import('../middlewares/rate-limit');
const { closeInviteQuota } = await import('../routes/workspace/invite-quota');
const { loadConfig } = await import('../config');

const { workspaces, subscriptions, members, memberInvites, auditLogs, workspaceEntitlementOverrides } =
  schema;

const DAY = 86_400_000;

/**
 * O tick de cobrança vive em `apps/workers` e o vite-node do vitest da API não carrega fontes
 * fora do root (o `rootDir` do tsc também proíbe o import estático): roda o `expireTrials`
 * REAL em um processo próprio (tsx), contra o mesmo banco. Devolve quantas empresas expirou.
 */
function runExpireTrials(workspaceId: string): number {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiRoot = path.resolve(here, '../..');
  const repoRoot = path.resolve(apiRoot, '../..');
  const out = execFileSync(
    process.execPath,
    [
      path.join(apiRoot, 'node_modules/tsx/dist/cli.mjs'),
      `--env-file=${path.join(repoRoot, '.env')}`,
      path.join(apiRoot, 'test/run-expire-trials.ts'),
      workspaceId,
    ],
    { cwd: apiRoot, encoding: 'utf8', timeout: 120_000 },
  );
  const line = out.trim().split(/\r?\n/).pop() ?? '';
  const parsed: unknown = JSON.parse(line);
  const expired = (parsed as { expired?: unknown }).expired;
  if (typeof expired !== 'number') throw new Error(`saída inesperada do tick: ${out}`);
  return expired;
}

const app = createApp();
const provider = getAuthProvider();
const isMock = provider instanceof MockAuthProvider;

describe.skipIf(!process.env['DATABASE_URL'] || !isMock)('jornada de contas (F71-S10)', () => {
  const mock = provider as InstanceType<typeof MockAuthProvider>;
  const run = randomUUID().slice(0, 8);
  const emailA = `jr-a-${run}@empresa.com`;
  const emailB = `jr-b-${run}@empresa.com`;
  const workspaceIds: string[] = [];
  const PASSWORD_A = 'senhaForte123';
  const PASSWORD_B = 'Senha-forte-B-123';

  const state = {
    wsA: '',
    wsB: '',
    ownerAMemberId: '',
    bInAMemberId: '',
    cookieA: '', // só hm_session de A
    cookieB: '', // só hm_session de B
    contactA: '',
    contactB: '',
  };

  // ─── helpers ──────────────────────────────────────────────────────────────
  function setCookies(res: request.Response): Record<string, string> {
    const raw: unknown = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
    const out: Record<string, string> = {};
    for (const c of list) {
      const [pair] = c.split(';');
      const idx = pair?.indexOf('=') ?? -1;
      if (pair && idx > 0) out[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return out;
  }
  const cookieHeader = (session: string, workspaceId?: string) =>
    workspaceId ? `${session}; hm_workspace=${workspaceId}` : session;

  const get = (p: string, cookie: string) => request(app).get(p).set('Cookie', cookie);
  const post = (p: string, cookie: string, body: object = {}) =>
    request(app).post(p).set('Cookie', cookie).send(body);
  const patch = (p: string, cookie: string, body: object) =>
    request(app).patch(p).set('Cookie', cookie).send(body);
  const del = (p: string, cookie: string) => request(app).delete(p).set('Cookie', cookie);

  function lastMail(address: string) {
    const mail = [...mock.outbox].reverse().find((m) => m.email === address.toLowerCase());
    if (!mail) throw new Error(`nenhum email para ${address}`);
    const link = new URL(mail.link);
    expect(link.search).toBe(''); // a prova nunca vai na query
    const fragment = new URLSearchParams(link.hash.slice(1));
    const type = fragment.get('type') === 'invite' ? ('invite' as const) : ('magiclink' as const);
    return {
      kind: mail.kind,
      token: link.pathname.split('/').pop() ?? '',
      proof: { tokenHash: fragment.get('token_hash') ?? '', type },
    };
  }
  const preview = (token: string) => request(app).post('/auth/invite/preview').send({ token });
  const accept = (body: object, cookie?: string) => {
    const r = request(app).post('/auth/invite/accept');
    return (cookie ? r.set('Cookie', cookie) : r).send(body);
  };

  async function login(email: string): Promise<{ session: string; workspaceId: string }> {
    const res = await request(app).post('/auth/login').send({ email, password: 'qualquer' });
    expect(res.status).toBe(200);
    const c = setCookies(res);
    const token = c['hm_session'];
    if (!token) throw new Error('login sem hm_session');
    return { session: `hm_session=${token}`, workspaceId: c['hm_workspace'] ?? '' };
  }

  beforeAll(async () => {
    await getDb()
      .insert(schema.plans)
      .values({ key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0 })
      .onConflictDoNothing({ target: schema.plans.key });
    // Limiters de borda (IP do host) acumulam entre execuções: zera só os buckets usados.
    const redis = new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      for (const bucket of [
        'login',
        'login_ip',
        'signup',
        'signup_ip',
        'reset',
        'reset_confirm',
        'verify',
        'resend',
        'resend_ip',
        'me_password',
        'invite_preview',
        'invite_accept',
        'invite_send_email',
      ]) {
        const keys = await redis.keys(`rl:${bucket}:*`);
        if (keys.length > 0) await redis.del(...keys);
      }
    } finally {
      await redis.quit();
    }
  });

  afterAll(async () => {
    const db = getDb();
    const own = await db
      .select({ workspaceId: members.workspaceId })
      .from(members)
      .where(inArray(members.email, [emailA, emailB]));
    const all = new Set([...workspaceIds, ...own.map((m) => m.workspaceId)]);
    if (all.size > 0) {
      await db.delete(workspaces).where(inArray(workspaces.id, [...all]));
    }
    await closeLoginCaptcha();
    await closeRateLimit();
    await closeInviteQuota();
    await closeHealth();
    await closeDb();
  });

  // ─── 1. signup → verify → login → A ──────────────────────────────────────
  it('1. signup com termos → verify → login: empresa A ativa, trial de 15 dias gravado', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({
        name: 'Dona da A',
        email: emailA,
        password: PASSWORD_A,
        workspaceName: `Jornada A ${run}`,
        turnstileToken: 'dev',
        acceptTerms: true,
        termsVersion: '2026-09-14',
      });
    expect(res.status).toBe(202);

    const db = getDb();
    const [owner] = await db.select().from(members).where(eq(members.email, emailA));
    expect(owner).toMatchObject({ role: 'OWNER', termsVersion: '2026-09-14', isPlatformAdmin: false });
    expect(owner?.status).not.toBe('active');
    if (!owner) throw new Error('owner');
    state.wsA = owner.workspaceId;
    state.ownerAMemberId = owner.id;
    workspaceIds.push(state.wsA);

    // Trial: 15 dias a partir do provisionamento, em workspace e subscription.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, state.wsA));
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, state.wsA));
    expect(ws?.subscriptionStatus).toBe('trial');
    expect(sub?.status).toBe('trial');
    for (const ends of [ws?.trialEndsAt, sub?.trialEndsAt]) {
      expect(ends).toBeInstanceOf(Date);
      expect(Math.abs((ends?.getTime() ?? 0) - (Date.now() + 15 * DAY))).toBeLessThan(5 * 60_000);
    }

    // Antes de confirmar: 403 e nenhum cookie.
    const blocked = await request(app).post('/auth/login').send({ email: emailA, password: PASSWORD_A });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('email_unverified');
    expect(blocked.headers['set-cookie']).toBeUndefined();

    await request(app).post('/auth/verify').send({ token: mockVerifyToken(emailA) }).expect(200);

    const a = await login(emailA);
    expect(a.workspaceId).toBe(state.wsA);
    state.cookieA = a.session;
    const me = await get('/api/me', cookieHeader(state.cookieA, state.wsA));
    expect(me.status).toBe(200);
    expect(me.body.workspace.id).toBe(state.wsA);
    expect(me.body.workspace.subscriptionStatus).toBe('trial');
    expect(me.body.memberships).toEqual([
      expect.objectContaining({ workspaceId: state.wsA, role: 'OWNER' }),
    ]);

    // Dado da empresa A (provará o isolamento adiante).
    const contact = await post('/api/contacts', cookieHeader(state.cookieA, state.wsA), {
      displayName: `Contato A ${run}`,
    });
    expect(contact.status).toBe(201);
    state.contactA = contact.body.contact.id as string;
  });

  // ─── 2. A convida B → aceite sem conta → login ───────────────────────────
  it('2. A convida B; B aceita sem conta com a prova da caixa; login: membro ativo de A, authUserId real, papel do convite', async () => {
    const cA = cookieHeader(state.cookieA, state.wsA);
    const created = await post('/api/members/invites', cA, { email: emailB, role: 'SUPERVISOR' });
    expect(created.status).toBe(201);
    expect(created.body.delivery).toBe('sent');
    expect(JSON.stringify(created.body)).not.toMatch(/token/i);

    const mail = lastMail(emailB);
    expect(mail.kind).toBe('invite');
    const pv = await preview(mail.token);
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ role: 'SUPERVISOR', requiresEmailProof: true });
    expect(pv.body.workspaceName).toBe(`Jornada A ${run}`);

    // Só com o link (sem a prova da caixa): 403 — mesmo com senha forte.
    const noProof = await accept({ token: mail.token, password: PASSWORD_B });
    expect(noProof.status).toBe(403);
    expect(noProof.body.error).toBe('email_proof_required');
    // Escalada de papel pelo corpo → 400 (strict).
    expect(
      (await accept({ token: mail.token, password: PASSWORD_B, emailProof: mail.proof, role: 'OWNER' }))
        .status,
    ).toBe(400);

    const ok = await accept({
      token: mail.token,
      password: PASSWORD_B,
      name: 'Pessoa B',
      emailProof: mail.proof,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ next: `/login?email=${encodeURIComponent(emailB)}` });
    expect(ok.headers['set-cookie']).toBeUndefined(); // sem auto-login

    const account = await mock.findUserByEmail(emailB);
    expect(account).toMatchObject({ emailConfirmed: true, hasPassword: true });
    const [bInA] = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, state.wsA), eq(members.email, emailB)));
    expect(bInA).toMatchObject({ status: 'active', role: 'SUPERVISOR', authUserId: account?.authUserId });
    if (!bInA) throw new Error('bInA');
    state.bInAMemberId = bInA.id;

    // Token reusado → 404 uniforme (preview e aceite).
    const reusedPv = await preview(mail.token);
    const reusedAc = await accept({ token: mail.token, password: PASSWORD_B, emailProof: mail.proof });
    expect(reusedPv.status).toBe(404);
    expect(reusedAc.status).toBe(404);
    expect(reusedAc.body).toEqual(reusedPv.body);

    const b = await login(emailB);
    expect(b.workspaceId).toBe(state.wsA);
    state.cookieB = b.session;
    const me = await get('/api/me', cookieHeader(state.cookieB, state.wsA));
    expect(me.body.member.role).toBe('SUPERVISOR');
    expect(me.body.workspace.id).toBe(state.wsA);
  });

  // ─── 3. B faz o próprio signup → duas empresas → troca ───────────────────
  it('3. B faz o próprio signup: tem A e a própria, troca entre elas, requests escopados e isolados', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({
        name: 'Pessoa B',
        email: emailB,
        password: PASSWORD_B,
        workspaceName: `Jornada B ${run}`,
        turnstileToken: 'dev',
        acceptTerms: true,
        termsVersion: '2026-09-14',
      });
    expect(res.status).toBe(202);

    const owned = await getDb()
      .select()
      .from(members)
      .where(and(eq(members.email, emailB), eq(members.role, 'OWNER')));
    expect(owned).toHaveLength(1);
    const own = owned[0];
    if (!own) throw new Error('own');
    state.wsB = own.workspaceId;
    workspaceIds.push(state.wsB);
    expect(state.wsB).not.toBe(state.wsA);
    // Mesmo auth_user_id nas duas empresas (membership por pessoa, não por email).
    const account = await mock.findUserByEmail(emailB);
    expect(own.authUserId).toBe(account?.authUserId);
    // A empresa nova só vale depois do verify; até lá só A aparece.
    const before = await get('/api/me', cookieHeader(state.cookieB, state.wsA));
    expect(before.body.memberships).toHaveLength(1);
    await request(app).post('/auth/verify').send({ token: mockVerifyToken(emailB) }).expect(200);

    const me = await get('/api/me', cookieHeader(state.cookieB, state.wsA));
    expect(me.status).toBe(200);
    expect(me.body.workspace.id).toBe(state.wsA);
    const list = me.body.memberships as Array<{ workspaceId: string; role: string }>;
    expect(list.map((m) => m.workspaceId).sort()).toEqual([state.wsA, state.wsB].sort());
    expect(Object.fromEntries(list.map((m) => [m.workspaceId, m.role]))).toEqual({
      [state.wsA]: 'SUPERVISOR',
      [state.wsB]: 'OWNER',
    });

    // Empresa alheia (inexistente ou de terceiros) → 404 uniforme e cookie intocado.
    const stranger = await post('/api/me/workspace', state.cookieB, { workspaceId: randomUUID() });
    expect(stranger.status).toBe(404);
    expect(stranger.headers['set-cookie']).toBeUndefined();

    // A → B: cookie hm_workspace de B, /api/me na B, dados isolados.
    const toB = await post('/api/me/workspace', cookieHeader(state.cookieB, state.wsA), {
      workspaceId: state.wsB,
    });
    expect(toB.status).toBe(200);
    expect(setCookies(toB)['hm_workspace']).toBe(state.wsB);
    expect(toB.body.workspace.id).toBe(state.wsB);
    expect(toB.body.member.role).toBe('OWNER');

    const cB = cookieHeader(state.cookieB, state.wsB);
    const contactB = await post('/api/contacts', cB, { displayName: `Contato B ${run}` });
    expect(contactB.status).toBe(201);
    state.contactB = contactB.body.contact.id as string;
    const listB = JSON.stringify((await get('/api/contacts?limit=100', cB)).body);
    expect(listB).toContain(`Contato B ${run}`);
    expect(listB).not.toContain(`Contato A ${run}`);
    // Detalhe por id de A, estando em B → 404 (RLS).
    expect((await get(`/api/contacts/${state.contactA}`, cB)).status).toBe(404);

    // B → A: o inverso.
    const toA = await post('/api/me/workspace', cB, { workspaceId: state.wsA });
    expect(toA.status).toBe(200);
    expect(setCookies(toA)['hm_workspace']).toBe(state.wsA);
    const cBA = cookieHeader(state.cookieB, state.wsA);
    const listA = JSON.stringify((await get('/api/contacts?limit=100', cBA)).body);
    expect(listA).toContain(`Contato A ${run}`);
    expect(listA).not.toContain(`Contato B ${run}`);
    expect((await get(`/api/contacts/${state.contactB}`, cBA)).status).toBe(404);

    // Trilha da troca na empresa de destino.
    const switched = await getDb()
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, state.wsB), eq(auditLogs.action, 'workspace.switched')));
    expect(switched.length).toBeGreaterThanOrEqual(1);

    // Login passa a cair na última empresa usada (A, pela última troca).
    const again = await login(emailB);
    expect(again.workspaceId).toBe(state.wsA);
    state.cookieB = again.session;
  });

  // ─── 4. remover B de A ───────────────────────────────────────────────────
  it('4. remover B de A: cookie de A é ignorado, B segue na própria; convite pendente é revogado ao bloquear; verify não reativa', async () => {
    const cA = cookieHeader(state.cookieA, state.wsA);
    expect((await del(`/api/members/${state.bInAMemberId}`, cA)).status).toBe(204);

    // Cookie de A antigo/forjado: ignorado, cai na própria; A some das memberships.
    const cBA = cookieHeader(state.cookieB, state.wsA);
    const stale = await get('/api/me', cBA);
    expect(stale.status).toBe(200);
    expect(stale.body.workspace.id).toBe(state.wsB);
    expect(stale.body.memberships).toEqual([expect.objectContaining({ workspaceId: state.wsB })]);
    // O dado de A não é lido com o cookie de A (o escopo é a própria).
    const leak = JSON.stringify((await get('/api/contacts?limit=100', cBA)).body);
    expect(leak).not.toContain(`Contato A ${run}`);
    expect((await get(`/api/contacts/${state.contactA}`, cBA)).status).toBe(404);
    // Troca de volta para A → 404 uniforme.
    expect((await post('/api/me/workspace', state.cookieB, { workspaceId: state.wsA })).status).toBe(404);
    // Segue operando na própria.
    const own = await post('/api/contacts', cookieHeader(state.cookieB, state.wsB), {
      displayName: `Contato B2 ${run}`,
    });
    expect(own.status).toBe(201);
    // Login de B cai na própria.
    expect((await login(emailB)).workspaceId).toBe(state.wsB);

    // T6 — verify (mesmo token válido do email de B) NÃO reativa a linha removida em A.
    await request(app).post('/auth/verify').send({ token: mockVerifyToken(emailB) }).expect(200);
    const [stillOut] = await getDb().select().from(members).where(eq(members.id, state.bInAMemberId));
    expect(stillOut?.status).toBe('inactive');

    // Reconvidar o removido é permitido → convite pendente; bloquear a linha o revoga.
    const re = await post('/api/members/invites', cA, { email: emailB, role: 'AGENT' });
    expect(re.status).toBe(201);
    const pending = lastMail(emailB);
    expect(pending.kind).toBe('sign_in_link'); // B tem conta
    expect((await preview(pending.token)).status).toBe(200);
    const block = await patch(`/api/members/${state.bInAMemberId}`, cA, { status: 'blocked' });
    expect(block.status).toBe(200);
    expect((await preview(pending.token)).status).toBe(404);
    const [row] = await getDb().select().from(memberInvites).where(eq(memberInvites.id, re.body.invite.id));
    expect(row?.revokedAt).toBeInstanceOf(Date);
    const revokedAudit = await getDb()
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.resourceId, re.body.invite.id), eq(auditLogs.action, 'member.invite_revoked')),
      );
    expect(revokedAudit).toHaveLength(1);
    // Bloqueado: nem convidar de novo.
    const blockedInvite = await post('/api/members/invites', cA, { email: emailB, role: 'AGENT' });
    expect(blockedInvite.status).toBe(409);
    expect(blockedInvite.body.error).toBe('member_blocked');
    // Segue fora de A.
    const final = await get('/api/me', cBA);
    expect(final.body.workspace.id).toBe(state.wsB);
  });

  // ─── 5. trial de A vence ─────────────────────────────────────────────────
  it('5. trial de A vence (tick do worker): A só leitura (402 na escrita, 200 na leitura, billing e troca livres); a própria de B segue plena', async () => {
    const db = getDb();
    // O admin desbloqueia B em A para provar a troca de empresa sob só leitura.
    const cA = cookieHeader(state.cookieA, state.wsA);
    const back = await patch(`/api/members/${state.bInAMemberId}`, cA, { status: 'active' });
    expect(back.status).toBe(200);
    const cBA = cookieHeader(state.cookieB, state.wsA);
    expect((await get('/api/me', cBA)).body.workspace.id).toBe(state.wsA);

    // Vence o trial de A (só A) e roda o tick REAL do worker de cobrança.
    const past = new Date(Date.now() - DAY);
    await db.update(workspaces).set({ trialEndsAt: past }).where(eq(workspaces.id, state.wsA));
    await db.update(subscriptions).set({ trialEndsAt: past }).where(eq(subscriptions.workspaceId, state.wsA));

    expect(runExpireTrials(state.wsA)).toBe(1);
    // Idempotente: rodar de novo não faz nada.
    expect(runExpireTrials(state.wsA)).toBe(0);

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, state.wsA));
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, state.wsA));
    expect(ws?.subscriptionStatus).toBe('expired');
    expect(sub?.status).toBe('expired');
    const trialAudit = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, state.wsA), eq(auditLogs.action, 'billing.trial_expired')));
    expect(trialAudit).toHaveLength(1);
    // A empresa de B não foi tocada.
    const [wsB] = await db.select().from(workspaces).where(eq(workspaces.id, state.wsB));
    expect(wsB?.subscriptionStatus).toBe('trial');

    // Dono de A: escrita 402; leitura 200; billing 200.
    const write = await post('/api/contacts', cA, { displayName: `Bloqueado ${run}` });
    expect(write.status).toBe(402);
    expect(write.body.error).toBe('subscription_inactive');
    const read = await get('/api/contacts?limit=100', cA);
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain(`Contato A ${run}`);
    expect((await get('/api/billing/subscription', cA)).status).toBe(200);
    const me = await get('/api/me', cA);
    expect(me.status).toBe(200);
    expect(me.body.workspace.subscriptionStatus).toBe('expired');
    // Gestão de membros também é escrita: barrada.
    expect((await patch(`/api/members/${state.bInAMemberId}`, cA, { role: 'AGENT' })).status).toBe(402);
    expect(
      (await post('/api/members/invites', cA, { email: `x-${run}@empresa.com`, role: 'AGENT' })).status,
    ).toBe(402);

    // B com A ativa: escrita 402, mas a troca de empresa é liberada e a própria tem acesso pleno.
    expect((await post('/api/contacts', cBA, { displayName: `Bloqueado B ${run}` })).status).toBe(402);
    const toOwn = await post('/api/me/workspace', cBA, { workspaceId: state.wsB });
    expect(toOwn.status).toBe(200);
    expect(toOwn.body.workspace.id).toBe(state.wsB);
    const cB = cookieHeader(state.cookieB, state.wsB);
    expect((await post('/api/contacts', cB, { displayName: `Livre B ${run}` })).status).toBe(201);
    // memberships mostra o estado de cada empresa (o seletor/aviso usa).
    const statuses = Object.fromEntries(
      (toOwn.body.memberships as Array<{ workspaceId: string; subscriptionStatus: string }>).map((m) => [
        m.workspaceId,
        m.subscriptionStatus,
      ]),
    );
    expect(statuses).toEqual({ [state.wsA]: 'expired', [state.wsB]: 'trial' });
  }, 90_000); // dois processos tsx (cold start) para o tick do worker

  // ─── Bordas ──────────────────────────────────────────────────────────────
  it('bordas: OWNER não convidável; expirado/revogado → 404 uniforme; prova de outro email → 403; max_members', async () => {
    // Empresa dedicada às bordas (A está só leitura): provisionada direto pelo banco.
    const db = getDb();
    const wsC = randomUUID();
    workspaceIds.push(wsC);
    await db.insert(workspaces).values({ id: wsC, name: `Bordas ${run}`, slug: `jr-c-${run}` });
    const adminEmail = `jr-c-admin-${run}@empresa.com`;
    await db.insert(members).values({
      workspaceId: wsC,
      authUserId: randomUUID(),
      email: adminEmail,
      name: 'Admin C',
      role: 'OWNER',
      status: 'active',
    });
    const session = (await mock.signIn({ email: adminEmail, password: 'x' })).accessToken;
    const cC = cookieHeader(`hm_session=${encodeURIComponent(session)}`, wsC);

    // OWNER não convidável.
    const owner = await post('/api/members/invites', cC, { email: `o-${run}@empresa.com`, role: 'OWNER' });
    expect(owner.status).toBe(400);
    expect(owner.body.error).toBe('owner_not_invitable');

    // Expirado e revogado: 404 idêntico ao de token inexistente.
    const unknown = await preview('x');
    const expAddr = `exp-${run}@empresa.com`;
    const exp = await post('/api/members/invites', cC, { email: expAddr, role: 'AGENT' });
    const expMail = lastMail(expAddr);
    await db
      .update(memberInvites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(memberInvites.id, exp.body.invite.id));
    const expPv = await preview(expMail.token);
    expect(expPv.status).toBe(404);
    expect(expPv.body).toEqual(unknown.body);
    expect(
      (await accept({ token: expMail.token, password: PASSWORD_B, emailProof: expMail.proof })).status,
    ).toBe(404);

    const revAddr = `rev-${run}@empresa.com`;
    const rev = await post('/api/members/invites', cC, { email: revAddr, role: 'AGENT' });
    const revMail = lastMail(revAddr);
    expect((await del(`/api/members/invites/${rev.body.invite.id}`, cC)).status).toBe(204);
    const revPv = await preview(revMail.token);
    expect(revPv.status).toBe(404);
    expect(revPv.body).toEqual(unknown.body);
    expect(
      (await accept({ token: revMail.token, password: PASSWORD_B, emailProof: revMail.proof })).status,
    ).toBe(404);

    // Prova da caixa de OUTRO email com o token de uma vítima → 403, sem criar conta/membro.
    const victim = `victim-${run}@empresa.com`;
    const other = `other-${run}@empresa.com`;
    await post('/api/members/invites', cC, { email: victim, role: 'AGENT' });
    const victimMail = lastMail(victim);
    await post('/api/members/invites', cC, { email: other, role: 'AGENT' });
    const otherMail = lastMail(other);
    const wrong = await accept({
      token: victimMail.token,
      password: PASSWORD_B,
      emailProof: otherMail.proof,
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe('email_proof_required');
    expect(await db.select().from(members).where(eq(members.email, victim))).toHaveLength(0);
    // A vítima, com a prova certa, ainda entra.
    const rightOk = await accept({
      token: victimMail.token,
      password: PASSWORD_B,
      emailProof: victimMail.proof,
    });
    expect(rightOk.status).toBe(200);

    // max_members: ativos + pendentes contam; estourou → 402 seat_limit.
    const seats = await get('/api/members/invites', cC);
    const used: number = seats.body.seats.used;
    await db.insert(workspaceEntitlementOverrides).values({ workspaceId: wsC, limits: { max_members: used } });
    const full = await post('/api/members/invites', cC, { email: `seat-${run}@empresa.com`, role: 'AGENT' });
    expect(full.status).toBe(402);
    expect(full.body).toMatchObject({ error: 'seat_limit', used, limit: used });
  });
});
