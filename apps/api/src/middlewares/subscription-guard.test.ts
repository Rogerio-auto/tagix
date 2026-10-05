/**
 * F71-S06 — modo só leitura por assinatura.
 *
 * 1) Regras puras: status efetivo (trial vencido = expired) e exceções por método + caminho.
 * 2) Contra o Postgres dev, com a sessão do MockAuthProvider (`AUTH_PROVIDER=mock`) e os
 *    routers REAIS (contatos, billing, perfil do membro), montados como no `app.ts`: a guarda
 *    entra pelo `withRLS`, sem nenhuma montagem extra. O status é trocado direto no banco
 *    entre os casos — o `requireAuth` relê a empresa a cada request.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../auth/session';
import { createBillingRouter } from '../routes/billing';
import { createContactsRouter } from '../routes/contacts';
import { createMembersMeRouter } from '../routes/members/me';
import {
  effectiveSubscriptionStatus,
  isExemptFromSubscriptionGuard,
  isSubscriptionInactive,
} from './subscription-guard';

const { workspaces, members } = schema;
const DAY = 24 * 60 * 60 * 1000;

// ─── 1) Regras puras ───────────────────────────────────────────────────────────

describe('effectiveSubscriptionStatus / isSubscriptionInactive', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');

  it('trial com trial_ends_at no passado (ou agora) é expired', () => {
    expect(effectiveSubscriptionStatus('trial', new Date(now.getTime() - 1), now)).toBe('expired');
    expect(effectiveSubscriptionStatus('trial', now, now)).toBe('expired');
    expect(isSubscriptionInactive('trial', now, now)).toBe(true);
  });

  it('trial no prazo, ou sem data (cortesia), segue trial e ativo', () => {
    expect(effectiveSubscriptionStatus('trial', new Date(now.getTime() + DAY), now)).toBe('trial');
    expect(isSubscriptionInactive('trial', null, now)).toBe(false);
  });

  it('expired e canceled bloqueiam; active e past_due não', () => {
    expect(isSubscriptionInactive('expired', null, now)).toBe(true);
    expect(isSubscriptionInactive('canceled', null, now)).toBe(true);
    expect(isSubscriptionInactive('active', null, now)).toBe(false);
    expect(isSubscriptionInactive('past_due', null, now)).toBe(false);
  });
});

describe('isExemptFromSubscriptionGuard', () => {
  it('libera billing, auth, /api/me, preferências e logout do próprio membro', () => {
    expect(isExemptFromSubscriptionGuard('POST', '/api/billing/checkout')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', '/api/billing/cancel')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', '/auth/logout')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', '/api/me/workspace')).toBe(true);
    expect(isExemptFromSubscriptionGuard('PUT', '/api/me/tour-state')).toBe(true);
    expect(isExemptFromSubscriptionGuard('PATCH', '/api/members/me')).toBe(true);
    expect(isExemptFromSubscriptionGuard('PATCH', '/api/members/me/dashboard-layout')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', '/api/members/me/password')).toBe(true);
    expect(isExemptFromSubscriptionGuard('DELETE', '/api/members/me/sessions/current')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', '/api/push/subscribe')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', '/api/support/threads')).toBe(true);
    expect(isExemptFromSubscriptionGuard('POST', `/api/conversations/${randomUUID()}/read`)).toBe(
      true,
    );
    expect(isExemptFromSubscriptionGuard('POST', '/api/privacy/exports')).toBe(true);
  });

  it('o roteador ignora caixa: a exceção também', () => {
    expect(isExemptFromSubscriptionGuard('post', '/API/Billing/Checkout')).toBe(true);
  });

  it('não vaza para rotas irmãs nem por prefixo parecido', () => {
    // DELETE /api/members/me cairia em DELETE /api/members/:id (remover membro).
    expect(isExemptFromSubscriptionGuard('DELETE', '/api/members/me')).toBe(false);
    expect(isExemptFromSubscriptionGuard('PATCH', `/api/members/${randomUUID()}`)).toBe(false);
    expect(isExemptFromSubscriptionGuard('POST', '/api/members/invites')).toBe(false);
    expect(isExemptFromSubscriptionGuard('POST', '/api/billingx')).toBe(false);
    expect(isExemptFromSubscriptionGuard('POST', '/api/meta/connections')).toBe(false);
    expect(isExemptFromSubscriptionGuard('POST', '/api/contacts')).toBe(false);
    expect(
      isExemptFromSubscriptionGuard('POST', `/api/conversations/${randomUUID()}/messages`),
    ).toBe(false);
    expect(isExemptFromSubscriptionGuard('POST', '/api/privacy/contacts/x/forget')).toBe(false);
  });
});

// ─── 2) Integração: routers reais + Postgres dev ──────────────────────────────

let ws = '';
let cookie = '';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(createContactsRouter());
  app.use(createMembersMeRouter());
  app.use(createBillingRouter());
  return app;
}

async function setStatus(status: string, trialEndsAt: Date | null = null): Promise<void> {
  await getDb()
    .update(workspaces)
    .set({ subscriptionStatus: status, trialEndsAt })
    .where(eq(workspaces.id, ws));
}

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: `RO ${sfx}`, slug: `ro-${sfx}`, subscriptionStatus: 'expired' })
    .returning();
  if (!w) throw new Error('workspace');
  ws = w.id;
  const authUserId = randomUUID();
  const email = `owner-ro-${sfx}@t.local`;
  await db.insert(members).values({
    workspaceId: ws,
    authUserId,
    email,
    role: 'OWNER',
    status: 'active',
  });
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString(
    'base64url',
  );
  cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('requireActiveSubscription (via withRLS, routers reais)', () => {
  const app = buildApp();

  it('expired: POST de domínio → 402 subscription_inactive (antes de validar o corpo)', async () => {
    await setStatus('expired');
    const res = await request(app).post('/api/contacts').set('Cookie', cookie).send({});
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_inactive');
  });

  it('expired: GET continua 200', async () => {
    await setStatus('expired');
    const res = await request(app).get('/api/contacts').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('expired: billing passa (GET 200; POST chega ao handler e valida o corpo)', async () => {
    await setStatus('expired');
    const get = await request(app).get('/api/billing/subscription').set('Cookie', cookie);
    expect(get.status).toBe(200);
    const post = await request(app).post('/api/billing/checkout').set('Cookie', cookie).send({});
    expect(post.status).toBe(400);
    expect(post.body.error).toBe('invalid_payload');
  });

  it('expired: preferências do próprio membro passam', async () => {
    await setStatus('expired');
    const res = await request(app)
      .patch('/api/members/me')
      .set('Cookie', cookie)
      .send({ themePreference: 'dark' });
    expect(res.status).toBe(200);
  });

  it('canceled bloqueia escrita como expired', async () => {
    await setStatus('canceled');
    const res = await request(app).post('/api/contacts').set('Cookie', cookie).send({});
    expect(res.status).toBe(402);
  });

  it('trial vencido bloqueia mesmo antes de o worker gravar expired', async () => {
    await setStatus('trial', new Date(Date.now() - 60_000));
    const res = await request(app).post('/api/contacts').set('Cookie', cookie).send({});
    expect(res.status).toBe(402);
  });

  it('trial no prazo e past_due passam (o handler responde, não a guarda)', async () => {
    await setStatus('trial', new Date(Date.now() + 15 * DAY));
    const trial = await request(app).post('/api/contacts').set('Cookie', cookie).send({});
    expect(trial.status).toBe(400);
    await setStatus('past_due');
    const pastDue = await request(app).post('/api/contacts').set('Cookie', cookie).send({});
    expect(pastDue.status).toBe(400);
  });

  it('sem sessão continua 401 (a guarda não antecipa nada)', async () => {
    await setStatus('expired');
    const res = await request(app).post('/api/contacts').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/me expõe o status da assinatura da empresa ativa', () => {
  it('workspace.subscriptionStatus e workspace.trialEndsAt vêm no payload', async () => {
    const ends = new Date(Date.now() - 60_000);
    await setStatus('expired', ends);
    // Import tardio: o router de auth é editado por outros slots; uma quebra lá fica
    // isolada neste caso em vez de derrubar o arquivo inteiro.
    const { createAuthRouter } = await import('../auth');
    const app = express();
    app.use(express.json());
    app.use(createAuthRouter());
    const res = await request(app).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.workspace.subscriptionStatus).toBe('expired');
    expect(new Date(res.body.workspace.trialEndsAt).getTime()).toBe(ends.getTime());
  });
});
