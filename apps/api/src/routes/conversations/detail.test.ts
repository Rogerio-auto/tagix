/**
 * F47-S04 — GET /api/conversations/:id read-through (deal + cadastro do contato).
 *
 * Integração com o Postgres dev (RLS real). Mocks de auth FIÉIS (estratégia de
 * items.test.ts). Provamos que o detalhe da conversa inclui:
 *  - `deal` (id, stageId, valueCents...) do card vinculado (null se não houver),
 *  - `contact` com o cadastro VIVO (address/document) — read-through.
 *
 * Skip automático se o Postgres dev não estiver acessível.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { can, type Permission, type Role } from '@hm/shared';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';

interface Session {
  workspaceId: string;
  memberId: string;
  role: Role;
}
let session: Session | null = null;

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!session) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    req.auth = {
      workspace: { id: session.workspaceId },
      member: { id: session.memberId, role: session.role },
    } as express.Request['auth'];
    next();
  },
  withRLS: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    const wsId = req.auth.workspace.id;
    (req as unknown as { scoped: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).scoped = (
      fn,
    ) => withWorkspace(wsId, fn as never);
    next();
  },
  requireRole:
    (perm: Permission) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.auth?.member.role as Role | undefined;
      if (!role || !can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

// O detalhe usa o cache versionado (getVersion). Mockamos cache p/ não depender
// de Redis no teste (o foco é o read-through, não o cache).
vi.mock('../../cache', () => ({
  getVersion: async () => 0,
  bumpVersion: async () => {},
  cached: async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
}));

const { createConversationsRouter } = await import('./index');

const app = express();
app.use(express.json());
app.use(createConversationsRouter());

const WS = randomUUID();
const MEMBER = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();
const PIPELINE = randomUUID();
const STAGE = randomUUID();

let dbAvailable = true;

beforeAll(async () => {
  try {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'WS', slug: `f47s04d-${WS.slice(0, 8)}` });
    await db.insert(schema.members).values({
      id: MEMBER,
      workspaceId: WS,
      authUserId: randomUUID(),
      email: `m-${MEMBER.slice(0, 8)}@x.test`,
      role: 'OWNER',
      status: 'active',
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      displayName: 'João',
      document: '52998224725',
      address: { city: 'Niterói', state: 'RJ', cep: '24000-000' },
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
    await db
      .insert(schema.pipelines)
      .values({ id: PIPELINE, workspaceId: WS, name: 'Funil', isDefault: true });
    await db
      .insert(schema.stages)
      .values({ id: STAGE, workspaceId: WS, pipelineId: PIPELINE, name: 'Novo', position: 0 });
  } catch (err) {
    dbAvailable = false;
    console.warn('[detail.test] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  }
  await closeDb();
});

async function freshConversation(): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.conversations)
    .values({ id, workspaceId: WS, channelId: CHANNEL, contactId: CONTACT, remoteId: `r-${id.slice(0, 12)}` });
  return id;
}

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'OWNER' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

describe('GET /api/conversations/:id — read-through', () => {
  maybe('inclui contact com cadastro vivo (address/document)', async () => {
    const conv = await freshConversation();
    const res = await request(app).get(`/api/conversations/${conv}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.contact.document).toBe('52998224725');
    expect(res.body.conversation.contact.address.state).toBe('RJ');
    // Sem deal vinculado ainda.
    expect(res.body.conversation.deal).toBeNull();
  });

  maybe('inclui deal (id/stage/value) quando há card vinculado', async () => {
    const conv = await freshConversation();
    const dealId = randomUUID();
    await getDb().insert(schema.deals).values({
      id: dealId,
      workspaceId: WS,
      pipelineId: PIPELINE,
      stageId: STAGE,
      contactId: CONTACT,
      conversationId: conv,
      title: 'Negócio',
      valueCents: 25000,
    });
    const res = await request(app).get(`/api/conversations/${conv}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.deal.id).toBe(dealId);
    expect(res.body.conversation.deal.stageId).toBe(STAGE);
    expect(res.body.conversation.deal.stageName).toBe('Novo');
    expect(res.body.conversation.deal.valueCents).toBe(25000);
  });
});
