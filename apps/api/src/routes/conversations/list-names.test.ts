/**
 * F70-S36 — a lista e o detalhe de conversas devolvem o nome no sistema e o nome de perfil do
 * contato, no mesmo SELECT (join, sem N+1); a busca casa os dois nomes; o isolamento entre
 * workspaces (RLS) se mantém. Postgres dev real; pula se indisponível.
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
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const wsId = req.auth!.workspace.id;
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
vi.mock('../../cache', () => ({
  getVersion: async () => 0,
  bumpVersion: async () => {},
  cached: async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
}));

const { createConversationsRouter } = await import('./index');
const app = express();
app.use(express.json());
app.use(createConversationsRouter());

const WS_A = randomUUID();
const WS_B = randomUUID();
const MEMBER_A = randomUUID();
const MEMBER_B = randomUUID();
let dbAvailable = true;
const convs: Record<string, string> = {};

async function seed(ws: string, member: string, tag: string) {
  const db = getDb();
  await db.insert(schema.workspaces).values({ id: ws, name: tag, slug: `f70s36-${ws.slice(0, 8)}` });
  await db.insert(schema.members).values({
    id: member,
    workspaceId: ws,
    authUserId: randomUUID(),
    email: `m-${member.slice(0, 8)}@x.test`,
    role: 'OWNER',
    status: 'active',
  });
  const channelId = randomUUID();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: ws,
    provider: 'waha',
    name: 'Canal',
    wahaSessionId: `s-${channelId.slice(0, 8)}`,
  });
  return channelId;
}

async function conversation(
  ws: string,
  channelId: string,
  key: string,
  contact: { displayName: string | null; profileName: string | null } | null,
) {
  const db = getDb();
  let contactId: string | null = null;
  if (contact) {
    contactId = randomUUID();
    await db.insert(schema.contacts).values({ id: contactId, workspaceId: ws, ...contact });
  }
  const id = randomUUID();
  await db.insert(schema.conversations).values({
    id,
    workspaceId: ws,
    channelId,
    contactId,
    remoteId: `r-${id.slice(0, 12)}`,
    lastMessageAt: new Date(),
  });
  convs[key] = id;
}

beforeAll(async () => {
  try {
    const chA = await seed(WS_A, MEMBER_A, 'A');
    const chB = await seed(WS_B, MEMBER_B, 'B');
    await conversation(WS_A, chA, 'both', { displayName: 'Maria Cliente', profileName: 'Mari Flor' });
    await conversation(WS_A, chA, 'profileOnly', { displayName: null, profileName: 'Zeca Pushname' });
    await conversation(WS_A, chA, 'none', null);
    await conversation(WS_B, chB, 'other', { displayName: 'Outro Tenant', profileName: 'Zeca Pushname' });
  } catch (err) {
    dbAvailable = false;
    console.warn('[list-names.test] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    const db = getDb();
    for (const ws of [WS_A, WS_B]) {
      await db.delete(schema.conversations).where(eq(schema.conversations.workspaceId, ws));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
    }
  }
  await closeDb();
});

beforeEach(() => {
  session = { workspaceId: WS_A, memberId: MEMBER_A, role: 'OWNER' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

type Row = { id: string; contactDisplayName: string | null; contactProfileName: string | null };

describe('F70-S36 lista/detalhe de conversas: nomes do contato', () => {
  maybe('a lista devolve contactDisplayName e contactProfileName (null sem contato)', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(200);
    const rows = res.body.conversations as Row[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(convs['both']!)).toMatchObject({
      contactDisplayName: 'Maria Cliente',
      contactProfileName: 'Mari Flor',
    });
    expect(byId.get(convs['profileOnly']!)).toMatchObject({
      contactDisplayName: null,
      contactProfileName: 'Zeca Pushname',
    });
    expect(byId.get(convs['none']!)).toMatchObject({
      contactDisplayName: null,
      contactProfileName: null,
    });
  });

  maybe('a busca casa display_name e profile_name', async () => {
    const byDisplay = await request(app).get('/api/conversations').query({ search: 'maria cli' });
    expect((byDisplay.body.conversations as Row[]).map((r) => r.id)).toEqual([convs['both']]);
    const byProfile = await request(app).get('/api/conversations').query({ search: 'pushname' });
    expect((byProfile.body.conversations as Row[]).map((r) => r.id)).toEqual([convs['profileOnly']]);
    // curinga do usuário é literal
    const wild = await request(app).get('/api/conversations').query({ search: '%' });
    expect(wild.body.conversations).toEqual([]);
  });

  maybe('o detalhe devolve contact.profileName', async () => {
    const res = await request(app).get(`/api/conversations/${convs['both']}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.contact.profileName).toBe('Mari Flor');
    expect(res.body.conversation.contact.displayName).toBe('Maria Cliente');
  });

  maybe('RLS: outro workspace não enxerga os nomes nem a conversa', async () => {
    session = { workspaceId: WS_B, memberId: MEMBER_B, role: 'OWNER' };
    const list = await request(app).get('/api/conversations');
    const ids = (list.body.conversations as Row[]).map((r) => r.id);
    expect(ids).toEqual([convs['other']]);
    const detail = await request(app).get(`/api/conversations/${convs['both']}`);
    expect(detail.status).toBe(404);
  });
});
