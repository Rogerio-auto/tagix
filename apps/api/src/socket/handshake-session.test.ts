/**
 * F71-S03: o handshake do Socket.io resolve a sessão com as MESMAS regras da API —
 * `hm_session` + empresa ativa `hm_workspace`, revalidada contra membership `active` do
 * `auth_user_id`. O socket entra na room `ws:<empresa ativa>`; cookie de empresa alheia é
 * ignorado (cai na padrão), nunca abre a room de outra empresa.
 *
 * Banco de dev real; provider de auth substituído por um dublê token → identidade.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthIdentity } from '@hm/shared';
import { closeDb, getDb, schema } from '@hm/db';

const liveTokens = new Map<string, AuthIdentity>();
vi.mock('../auth/provider', () => ({
  getAuthProvider: () => ({
    verifyToken: async (token: string) => liveTokens.get(token) ?? null,
  }),
}));

const { handshakeAuth, resolveHandshakeSession, sessionRooms } = await import('./index');

const created: string[] = [];
const authUserId = randomUUID();
const token = `sock-${randomUUID()}`;
let wsLast = '';
let wsOther = '';
let wsForeign = '';
let memberOther = '';

async function workspace(): Promise<string> {
  const sfx = randomUUID().slice(0, 8);
  const [ws] = await getDb()
    .insert(schema.workspaces)
    .values({ name: `Sock ${sfx}`, slug: `sock-${sfx}` })
    .returning({ id: schema.workspaces.id });
  created.push(ws!.id);
  return ws!.id;
}

async function member(workspaceId: string, who: string, lastActiveAt: Date | null) {
  const [m] = await getDb()
    .insert(schema.members)
    .values({
      workspaceId,
      authUserId: who,
      email: `sock-${who.slice(0, 8)}@t.local`,
      role: 'AGENT',
      status: 'active',
      lastActiveAt,
    })
    .returning({ id: schema.members.id });
  return m!.id;
}

beforeAll(async () => {
  wsLast = await workspace();
  wsOther = await workspace();
  wsForeign = await workspace();
  await member(wsLast, authUserId, new Date());
  memberOther = await member(wsOther, authUserId, new Date(Date.now() - 86_400_000));
  await member(wsForeign, randomUUID(), new Date());
  liveTokens.set(token, { authUserId, email: 'sock@t.local' });
});

afterAll(async () => {
  const db = getDb();
  for (const id of created) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  await closeDb();
});

/** Socket mínimo que o middleware de handshake lê/escreve. */
function fakeSocket(cookie: string | undefined) {
  return {
    handshake: { headers: { cookie }, url: '/socket.io/' },
    conn: { transport: { name: 'polling' } },
    data: {} as { session?: unknown },
  };
}

function runHandshake(cookie: string | undefined) {
  const socket = fakeSocket(cookie);
  return new Promise<{ socket: ReturnType<typeof fakeSocket>; err: Error | undefined }>(
    (resolve) => {
      handshakeAuth(socket as unknown as Parameters<typeof handshakeAuth>[0], (err) =>
        resolve({ socket, err }),
      );
    },
  );
}

describe('handshake do socket — empresa ativa', () => {
  it('com hm_workspace válido → sessão e room da empresa escolhida', async () => {
    const r = await resolveHandshakeSession(`hm_session=${token}; hm_workspace=${wsOther}`);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.session.workspace.id).toBe(wsOther);
    expect(sessionRooms(r.session)).toEqual([`ws:${wsOther}`, `member:${memberOther}`]);
  });

  it('sem hm_workspace → empresa usada por último', async () => {
    const r = await resolveHandshakeSession(`hm_session=${token}`);
    expect(r.kind === 'ok' && r.session.workspace.id).toBe(wsLast);
  });

  it('hm_workspace de empresa alheia → ignorado; nunca entra na room dela', async () => {
    const r = await resolveHandshakeSession(`hm_session=${token}; hm_workspace=${wsForeign}`);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.session.workspace.id).toBe(wsLast);
    expect(sessionRooms(r.session)).not.toContain(`ws:${wsForeign}`);
  });

  it('middleware io.use: anexa a sessão da empresa ativa ao socket', async () => {
    const { socket, err } = await runHandshake(`hm_session=${token}; hm_workspace=${wsOther}`);
    expect(err).toBeUndefined();
    const session = socket.data.session as { workspace: { id: string } } | undefined;
    expect(session?.workspace.id).toBe(wsOther);
  });

  it('middleware io.use: sem sessão → `unauthorized` (contrato com o web)', async () => {
    const { socket, err } = await runHandshake(`hm_workspace=${wsOther}`);
    expect(err?.message).toBe('unauthorized');
    expect(socket.data.session).toBeUndefined();
  });
});
