/**
 * F71-S05 — convites (admin): contrato sem banco. Autenticação antes de tudo (401), forma
 * pública do convite (sem token/hash), assentos e o link copiável. O caminho com banco
 * está em `invites.integration.test.ts`.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb, type MemberInviteView } from '@hm/db';
import { uuidParamGuard } from '../../middlewares/uuid-params';
import {
  createInvitesRouter,
  invitePath,
  inviteUrl,
  MAX_INVITE_SENDS,
  publicInvite,
  seatsAvailable,
} from './invites';

const app = express();
app.use(express.json());
app.use(uuidParamGuard);
app.use(createInvitesRouter());

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ID = '00000000-0000-0000-0000-000000000001';

describe('rotas de convite (admin) — autenticação', () => {
  it.each([
    ['get', '/api/members/invites'],
    ['post', '/api/members/invites'],
    ['post', `/api/members/invites/${ID}/resend`],
    ['delete', `/api/members/invites/${ID}`],
    ['post', `/api/members/invites/${ID}/link`],
  ] as const)('%s %s sem sessão → 401', async (method, path) => {
    expect((await request(app)[method](path).send({})).status).toBe(401);
  });

  it('copiar link é POST (escrita): o GET antigo não existe mais (B5)', async () => {
    expect((await request(app).get(`/api/members/invites/${ID}/link`)).status).toBe(404);
  });

  it('o guard de UUID deixa `/api/members/invites` passar até o requireAuth (literal)', async () => {
    // Cookie presente (o guard só age com sessão), mas inválido: chega ao requireAuth → 401,
    // não ao 404 do guard.
    const res = await request(app).get('/api/members/invites').set('Cookie', 'hm_session=lixo');
    expect(res.status).toBe(401);
  });
});

describe('publicInvite', () => {
  const base: MemberInviteView = {
    id: ID,
    workspaceId: ID,
    email: 'ana@x.com',
    role: 'AGENT',
    departmentId: null,
    invitedBy: null,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    revokedAt: null,
    acceptedMemberId: null,
    lastSentAt: new Date(),
    sendCount: 2,
    createdAt: new Date(),
  };

  it('não carrega token nem hash; calcula vencido e reenvios restantes', () => {
    const out = publicInvite(base);
    expect(JSON.stringify(out)).not.toMatch(/token|hash/i);
    expect(out.expired).toBe(false);
    expect(out.resendsLeft).toBe(MAX_INVITE_SENDS - 2);
    expect(publicInvite({ ...base, expiresAt: new Date(Date.now() - 1) }).expired).toBe(true);
    expect(publicInvite({ ...base, sendCount: 99 }).resendsLeft).toBe(0);
  });
});

describe('seatsAvailable', () => {
  it('sem limite = ilimitado; com limite conta ativos + pendentes', () => {
    expect(seatsAvailable({ used: 10_000, limit: null }, 1)).toBe(true);
    expect(seatsAvailable({ used: 4, limit: 5 }, 1)).toBe(true);
    expect(seatsAvailable({ used: 5, limit: 5 }, 1)).toBe(false);
    expect(seatsAvailable({ used: 5, limit: 5 }, 0)).toBe(true);
    expect(seatsAvailable({ used: 0, limit: 0 }, 1)).toBe(false);
  });
});

describe('link do convite', () => {
  const token = 'A'.repeat(43);

  it('caminho do app e URL absoluta na base configurada', () => {
    expect(invitePath(token)).toBe(`/convite/${token}`);
    vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', 'https://app.leadium.com.br');
    expect(inviteUrl(token)).toBe(`https://app.leadium.com.br/convite/${token}`);
  });

  it('produção sem base configurada → null (a rota responde 503, nunca um link quebrado)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', '');
    vi.stubEnv('APP_PUBLIC_URL', '');
    expect(inviteUrl(token)).toBeNull();
  });

  it('dev sem base → origem local do web', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', '');
    vi.stubEnv('APP_PUBLIC_URL', '');
    expect(inviteUrl(token)).toBe(`http://localhost:3000/convite/${token}`);
  });
});
