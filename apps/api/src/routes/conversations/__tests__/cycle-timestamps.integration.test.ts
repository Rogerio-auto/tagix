/**
 * F55-S02 — gravação dos marcos de ciclo pelo write path HTTP, contra o Postgres
 * dev (RLS real). Cobre os dois caminhos restantes (o de agent tools fica em
 * `internal/tools/__tests__/cycle-timestamps.integration.test.ts`):
 *
 *  - `POST /:id/status` (resolve manual) grava `resolved_at` uma única vez —
 *    reabrir + resolver de novo não sobrescreve o marco original.
 *  - `POST /:id/messages` (1ª resposta de member) grava `first_response_at` na 1ª
 *    mensagem outbound e NÃO o altera na 2ª (idempotente — guard `coalesce`).
 *
 * Auth: mocks FIÉIS (mesma estratégia de pipeline/deal-conversation.test.ts) —
 * `requireAuth` recusa sem sessão (401), `requireRole` usa o `can()` REAL,
 * `withRLS` injeta `req.scoped = withWorkspace` real. Mq + publisher outbound
 * mockados (sem broker). Skip automático se o Postgres dev não estiver acessível.
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

vi.mock('../../../middlewares/auth', () => ({
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

// Relay de socket + publisher outbound: sem broker nos testes.
vi.mock('@hm/shared/mq', () => ({
  connectMq: vi.fn().mockResolvedValue({ channel: { sendToQueue: vi.fn() }, connection: {} }),
  makeEnvelope: (_type: string, _ws: string, payload: unknown) => payload,
}));
vi.mock('../../../mq/outbound-publisher', () => ({
  publishOutboundJob: vi.fn().mockResolvedValue(true),
}));

const { createConversationStateRouter } = await import('../state');
const { createMessagesRouter } = await import('../messages');

const app = express();
app.use(express.json());
app.use(createConversationStateRouter());
app.use(createMessagesRouter());

const WS = randomUUID();
const MEMBER = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();

let dbAvailable = true;

async function readCycle(
  conversationId: string,
): Promise<{ firstResponseAt: Date | null; resolvedAt: Date | null }> {
  const [row] = await getDb()
    .select({
      firstResponseAt: schema.conversations.firstResponseAt,
      resolvedAt: schema.conversations.resolvedAt,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (!row) throw new Error('conversa sumiu');
  return row;
}

async function freshConversation(aiMode = 'off'): Promise<string> {
  const id = randomUUID();
  await getDb().insert(schema.conversations).values({
    id,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: `r-${id.slice(0, 12)}`,
    aiMode,
    status: 'open',
  });
  return id;
}

beforeAll(async () => {
  try {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'F55S02 http', slug: `f55s02h-${WS.slice(0, 8)}` });
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
      displayName: 'Lead HTTP',
      phone: `+55119${WS.slice(0, 8)}`,
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal HTTP',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
  } catch (err) {
    dbAvailable = false;
    console.warn('[cycle-timestamps http] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  }
  await closeDb();
});

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'OWNER' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

describe('F55-S02 — resolved_at via POST /:id/status', () => {
  maybe('resolve manual grava resolved_at uma única vez (idempotente ao reabrir+resolver)', async () => {
    const conv = await freshConversation();

    const r1 = await request(app).post(`/api/conversations/${conv}/status`).send({ status: 'resolved' });
    expect(r1.status).toBe(200);
    const after1 = await readCycle(conv);
    expect(after1.resolvedAt).toBeInstanceOf(Date);
    const firstResolvedAt = after1.resolvedAt!.getTime();

    // Reabre (open) — não limpa o marco.
    const reopen = await request(app).post(`/api/conversations/${conv}/status`).send({ status: 'open' });
    expect(reopen.status).toBe(200);
    expect((await readCycle(conv)).resolvedAt!.getTime()).toBe(firstResolvedAt);

    // Resolve de novo — resolved_at preservado.
    await request(app).post(`/api/conversations/${conv}/status`).send({ status: 'resolved' });
    expect((await readCycle(conv)).resolvedAt!.getTime()).toBe(firstResolvedAt);
  });
});

describe('F55-S02 — first_response_at via POST /:id/messages', () => {
  maybe('1ª resposta de member grava first_response_at; 2ª não sobrescreve', async () => {
    const conv = await freshConversation('off');

    const before = await readCycle(conv);
    expect(before.firstResponseAt).toBeNull();

    const m1 = await request(app)
      .post(`/api/conversations/${conv}/messages`)
      .send({ content: 'primeira resposta', type: 'text' });
    expect(m1.status).toBe(201);
    const after1 = await readCycle(conv);
    expect(after1.firstResponseAt).toBeInstanceOf(Date);
    const firstAt = after1.firstResponseAt!.getTime();

    const m2 = await request(app)
      .post(`/api/conversations/${conv}/messages`)
      .send({ content: 'segunda resposta', type: 'text' });
    expect(m2.status).toBe(201);
    const after2 = await readCycle(conv);
    expect(after2.firstResponseAt!.getTime()).toBe(firstAt);
  });

  maybe('com IA on, 1ª resposta humana (handoff paused) também grava first_response_at', async () => {
    const conv = await freshConversation('on');
    const m1 = await request(app)
      .post(`/api/conversations/${conv}/messages`)
      .send({ content: 'assumindo a conversa', type: 'text' });
    expect(m1.status).toBe(201);
    expect((await readCycle(conv)).firstResponseAt).toBeInstanceOf(Date);
  });
});
