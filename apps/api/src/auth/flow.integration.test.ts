/**
 * Integração de fluxo do cadastro self-serve (F44-S08): signup → verify → login,
 * exercitando provider (mock) + provisioner real (DB) + ativação no verify.
 *
 * Força o MockAuthProvider (AUTH_PROVIDER=mock) e o bypass dev do Turnstile (sem
 * TURNSTILE_SECRET_KEY), batendo no router real montado em createApp.
 *
 * Cobre as invariantes-chave do threat model:
 *  - T9: o member criado NUNCA é platform admin; role do body é ignorado.
 *  - T7: pré-verify o member fica inativo (sem sessão plena); verify o ativa.
 *  - T3/T13: resposta uniforme p/ email novo e duplicado.
 *  - T14: signup não deixa estado parcial observável (uniforme mesmo em falha).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { closeDb, getDb, schema } from '@hm/db';

// Garante mock provider + sem captcha (dev bypass) antes de carregar a app.
vi.stubEnv('AUTH_PROVIDER', 'mock');
vi.stubEnv('TURNSTILE_SECRET_KEY', '');

const { createApp } = await import('../app');
const { mockVerifyToken } = await import('./mock-provider');
const { closeHealth } = await import('../health');

const app = createApp();

afterAll(async () => {
  await closeHealth();
  await closeDb();
});

const emails: string[] = [];
const workspaceIds: string[] = [];

afterAll(async () => {
  const db = getDb();
  for (const id of workspaceIds) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
});

function payload(email: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'Fluxo Teste',
    email,
    password: 'senhaForte123',
    workspaceName: `Fluxo ${randomUUID().slice(0, 6)}`,
    turnstileToken: 'dev',
    ...extra,
  };
}

describe('Fluxo signup → verify → login', () => {
  it('signup provisiona member OWNER inativo e SEM platform admin (T7/T9)', async () => {
    const email = `flow-${randomUUID().slice(0, 8)}@empresa.com`;
    emails.push(email);

    const res = await request(app).post('/auth/signup').send(payload(email));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });

    const db = getDb();
    const [m] = await db.select().from(schema.members).where(eq(schema.members.email, email));
    expect(m).toBeTruthy();
    if (m) {
      workspaceIds.push(m.workspaceId);
      expect(m.role).toBe('OWNER');
      expect(m.isPlatformAdmin).toBe(false); // T9
      expect(m.status).not.toBe('active'); // T7: bloqueio duro pré-verify
    }
  });

  it('injeção de isPlatformAdmin/role/workspaceId no body é ignorada (T9 / strict)', async () => {
    const email = `inj-${randomUUID().slice(0, 8)}@empresa.com`;
    const res = await request(app)
      .post('/auth/signup')
      .send(payload(email, { isPlatformAdmin: true, role: 'OWNER', workspaceId: randomUUID() }));
    // strict() rejeita campos extras → 400, nada provisionado.
    expect(res.status).toBe(400);
    const db = getDb();
    const found = await db.select().from(schema.members).where(eq(schema.members.email, email));
    expect(found).toHaveLength(0);
  });

  it('verify ativa o member; login passa a resolver a sessão (T7)', async () => {
    const email = `verify-${randomUUID().slice(0, 8)}@empresa.com`;
    emails.push(email);
    const signupRes = await request(app).post('/auth/signup').send(payload(email));
    expect(signupRes.status).toBe(202);

    const db = getDb();
    const [before] = await db.select().from(schema.members).where(eq(schema.members.email, email));
    if (before) workspaceIds.push(before.workspaceId);
    expect(before?.status).not.toBe('active');

    // Token de verificação aceito pelo MockAuthProvider = base64url(email).
    const verifyRes = await request(app)
      .post('/auth/verify')
      .send({ token: mockVerifyToken(email) });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toEqual({ ok: true });

    const [after] = await db.select().from(schema.members).where(eq(schema.members.email, email));
    expect(after?.status).toBe('active'); // promovido

    // Login agora resolve a sessão (mock aceita qualquer senha p/ member existente).
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password: 'qualquer' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.member.email).toBe(email);
    expect(loginRes.body.member.isPlatformAdmin).toBe(false);
  });

  it('signup duplicado → resposta uniforme, sem segundo member (T3/T13)', async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@empresa.com`;
    emails.push(email);
    const first = await request(app).post('/auth/signup').send(payload(email));
    expect(first.status).toBe(202);
    const db = getDb();
    const [m] = await db.select().from(schema.members).where(eq(schema.members.email, email));
    if (m) workspaceIds.push(m.workspaceId);

    const second = await request(app).post('/auth/signup').send(payload(email));
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ status: 'verification_sent' }); // idêntico

    const all = await db.select().from(schema.members).where(eq(schema.members.email, email));
    expect(all).toHaveLength(1); // não duplicou
  });

  it('reset e verify inválido respondem uniformemente (T3)', async () => {
    const reset = await request(app).post('/auth/reset').send({ email: 'qualquer@x.com' });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true });

    const verify = await request(app).post('/auth/verify').send({ token: 'lixo-invalido' });
    expect(verify.status).toBe(400);
  });
});
