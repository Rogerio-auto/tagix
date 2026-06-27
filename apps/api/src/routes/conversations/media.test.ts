/**
 * F52-S06 — GET /api/conversations/:id/messages/:messageId/refresh-media-url.
 *
 * Integração com o Postgres dev (RLS real). Mocks de auth FIÉIS (mesma estratégia
 * de detail.test.ts). Storage = LocalDriver (default 'local'), sem infra externa:
 * o presign é HMAC local, então o teste roda sem R2.
 *
 * Provamos:
 *  - mensagem sem `metadata.mediaKey` → 404 (nada a reidratar),
 *  - mensagem com key → 200 com `mediaUrl` (nova) + `expiresAt` futuro,
 *  - conversa fora de escopo (AGENT sem visibilidade) → 404 (IDOR-safe),
 *  - sem auth → 401.
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

// O router agregador usa o cache versionado (getVersion) em outras rotas; mockamos
// p/ não depender de Redis (o foco aqui é o refresh de mídia).
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
const OUTSIDER = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();

let dbAvailable = true;

beforeAll(async () => {
  try {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'WS', slug: `f52s06-${WS.slice(0, 8)}` });
    await db.insert(schema.members).values({
      id: MEMBER,
      workspaceId: WS,
      authUserId: randomUUID(),
      email: `m-${MEMBER.slice(0, 8)}@x.test`,
      role: 'OWNER',
      status: 'active',
    });
    await db.insert(schema.members).values({
      id: OUTSIDER,
      workspaceId: WS,
      authUserId: randomUUID(),
      email: `o-${OUTSIDER.slice(0, 8)}@x.test`,
      role: 'AGENT',
      status: 'active',
    });
    await db.insert(schema.contacts).values({ id: CONTACT, workspaceId: WS, displayName: 'João' });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
  } catch (err) {
    dbAvailable = false;
    console.warn('[media.test] Postgres dev indisponível — testes pulados.', err);
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
  await getDb().insert(schema.conversations).values({
    id,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: `r-${id.slice(0, 12)}`,
  });
  return id;
}

async function insertMessage(
  conversationId: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  await getDb().insert(schema.messages).values({
    id,
    workspaceId: WS,
    conversationId,
    direction: 'inbound',
    senderType: 'contact',
    type: 'image',
    mediaUrl: 'http://stale.example/expired',
    metadata,
  });
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

describe('GET /api/conversations/:id/messages/:messageId/refresh-media-url', () => {
  maybe('mensagem sem mediaKey → 404', async () => {
    const conv = await freshConversation();
    const msg = await insertMessage(conv, {});
    const res = await request(app).get(
      `/api/conversations/${conv}/messages/${msg}/refresh-media-url`,
    );
    expect(res.status).toBe(404);
  });

  maybe('mensagem com mediaKey → 200 com mediaUrl nova + expiresAt futuro', async () => {
    const conv = await freshConversation();
    const key = `workspaces/${WS}/media/${randomUUID()}.jpg`;
    const msg = await insertMessage(conv, { mediaKey: key });

    const res = await request(app).get(
      `/api/conversations/${conv}/messages/${msg}/refresh-media-url`,
    );
    expect(res.status).toBe(200);
    expect(typeof res.body.mediaUrl).toBe('string');
    expect(res.body.mediaUrl.length).toBeGreaterThan(0);
    // A nova URL referencia a key estável (re-presign, não a URL stale persistida).
    expect(res.body.mediaUrl).toContain(encodeURIComponent(key));
    expect(res.body.mediaUrl).not.toBe('http://stale.example/expired');
    // expiresAt é uma data válida no futuro.
    const expiresAt = new Date(res.body.expiresAt);
    expect(Number.isNaN(expiresAt.getTime())).toBe(false);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  maybe('mensagem de outra conversa (id cruzado) → 404', async () => {
    const convA = await freshConversation();
    const convB = await freshConversation();
    const msg = await insertMessage(convA, { mediaKey: `workspaces/${WS}/m/${randomUUID()}.jpg` });
    // Pede a key de uma mensagem de convA usando o id de convB → não casa.
    const res = await request(app).get(
      `/api/conversations/${convB}/messages/${msg}/refresh-media-url`,
    );
    expect(res.status).toBe(404);
  });

  maybe('AGENT sem visibilidade da conversa → 404 (IDOR-safe)', async () => {
    const conv = await freshConversation();
    const msg = await insertMessage(conv, { mediaKey: `workspaces/${WS}/m/${randomUUID()}.jpg` });
    // Conversa não atribuída e sem override → AGENT não enxerga.
    session = { workspaceId: WS, memberId: OUTSIDER, role: 'AGENT' };
    const res = await request(app).get(
      `/api/conversations/${conv}/messages/${msg}/refresh-media-url`,
    );
    expect(res.status).toBe(404);
  });

  maybe('sem auth → 401', async () => {
    const conv = await freshConversation();
    const msg = await insertMessage(conv, { mediaKey: `workspaces/${WS}/m/${randomUUID()}.jpg` });
    session = null;
    const res = await request(app).get(
      `/api/conversations/${conv}/messages/${msg}/refresh-media-url`,
    );
    expect(res.status).toBe(401);
  });
});
