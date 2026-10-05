/**
 * Verificação de token resiliente (fix do handshake flaky do socket + SEC-08).
 * Contrato: cache fresh evita rede; stale-on-error SÓ quando o provider LANÇA
 * (indisponibilidade de infra); `null` do provider = token genuinamente inválido
 * (expirado/revogado) → rejeição imediata + purga do cache, NUNCA stale; token
 * forjado (nunca visto) → null.
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthIdentity } from '@hm/shared';
import { closeDb, getDb, schema } from '@hm/db';

const verifyTokenMock = vi.fn<(token: string) => Promise<AuthIdentity | null>>();
vi.mock('./provider', () => ({
  getAuthProvider: () => ({ verifyToken: verifyTokenMock }),
}));

const {
  verifyTokenResilient,
  resolveSessionStatus,
  __resetIdentityCache,
  WORKSPACE_COOKIE,
  clearActiveWorkspaceCookie,
  preferredWorkspaceFromHeader,
  readCookieFromHeader,
  setActiveWorkspaceCookie,
} = await import('./session');

const ID: AuthIdentity = { authUserId: 'u1', email: 'a@b.com' };
const netErr = () => new Error('fetch failed');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  verifyTokenMock.mockReset();
  __resetIdentityCache();
});

describe('verifyTokenResilient', () => {
  it('fresh: 2ª chamada dentro de 5min não toca o provider', async () => {
    verifyTokenMock.mockResolvedValue(ID);
    expect(await verifyTokenResilient('tok')).toEqual(ID);
    vi.setSystemTime(60_000); // +1min (dentro do fresh)
    expect(await verifyTokenResilient('tok')).toEqual(ID);
    expect(verifyTokenMock).toHaveBeenCalledTimes(1);
  });

  it('stale-on-error: fresh expirou e o provider LANÇA (rede) → serve o último bom', async () => {
    verifyTokenMock.mockResolvedValueOnce(ID);
    await verifyTokenResilient('tok'); // sucesso @0
    vi.setSystemTime(6 * 60_000); // +6min (fresh 5min expirou)
    verifyTokenMock.mockRejectedValueOnce(netErr()); // blip de infra
    expect(await verifyTokenResilient('tok')).toEqual(ID); // não rejeita
    expect(verifyTokenMock).toHaveBeenCalledTimes(2);
  });

  it('SEC-08: provider retorna null (token expirado/revogado) → rejeita NA HORA, sem stale', async () => {
    verifyTokenMock.mockResolvedValueOnce(ID);
    await verifyTokenResilient('tok'); // sucesso @0
    vi.setSystemTime(6 * 60_000); // +6min — dentro da janela stale (15min)
    verifyTokenMock.mockResolvedValueOnce(null); // invalidação legítima do provider
    expect(await verifyTokenResilient('tok')).toBeNull(); // NUNCA honra revogado
  });

  it('SEC-08: após null, nem uma falha de rede subsequente ressuscita o token (cache purgado)', async () => {
    verifyTokenMock.mockResolvedValueOnce(ID);
    await verifyTokenResilient('tok'); // @0
    vi.setSystemTime(6 * 60_000);
    verifyTokenMock.mockResolvedValueOnce(null); // revogado → purga
    await verifyTokenResilient('tok');
    verifyTokenMock.mockRejectedValueOnce(netErr()); // agora a rede cai
    expect(await verifyTokenResilient('tok')).toBeNull(); // sem entrada → sem stale
  });

  it('além do stale (15min) com provider lançando → null', async () => {
    verifyTokenMock.mockResolvedValueOnce(ID);
    await verifyTokenResilient('tok'); // @0
    vi.setSystemTime(16 * 60_000); // +16min (> stale 15min)
    verifyTokenMock.mockRejectedValueOnce(netErr());
    expect(await verifyTokenResilient('tok')).toBeNull();
  });

  it('token nunca-visto: provider null → null (não inventa sessão)', async () => {
    verifyTokenMock.mockResolvedValue(null);
    expect(await verifyTokenResilient('forjado')).toBeNull();
  });

  it('token nunca-visto: provider lança → null (indisponibilidade não autentica)', async () => {
    verifyTokenMock.mockRejectedValue(netErr());
    expect(await verifyTokenResilient('desconhecido')).toBeNull();
  });
});

/**
 * F70-S28: o motivo da recusa decide o destino do cliente. `invalid` → 401 e volta ao
 * login; `unavailable` → 503 e ninguém é deslogado por instabilidade do provider.
 */
describe('resolveSessionStatus', () => {
  it('token expirado/revogado (provider null) → invalid', async () => {
    verifyTokenMock.mockResolvedValue(null);
    expect(await resolveSessionStatus('morto')).toEqual({ kind: 'invalid' });
  });

  it('provider fora do ar sem cache → unavailable (não é sessão morta)', async () => {
    verifyTokenMock.mockRejectedValue(netErr());
    expect(await resolveSessionStatus('desconhecido')).toEqual({ kind: 'unavailable' });
  });
});

// ─── F71-S03 — empresa ativa (`hm_workspace`) ───────────────────────────────

describe('cookie hm_workspace (leitura)', () => {
  const WS = '0b8f3a52-6a1e-4c5b-9a43-2f1d8e7c6b5a';

  it('lê só UUID; normaliza para minúsculas', () => {
    expect(preferredWorkspaceFromHeader(`a=1; hm_workspace=${WS.toUpperCase()}; b=2`)).toBe(WS);
  });

  it('ausente, vazio, malformado ou com escape inválido → null', () => {
    expect(preferredWorkspaceFromHeader(undefined)).toBeNull();
    expect(preferredWorkspaceFromHeader('hm_session=x')).toBeNull();
    expect(preferredWorkspaceFromHeader('hm_workspace=')).toBeNull();
    expect(preferredWorkspaceFromHeader("hm_workspace=x'%20or%201=1")).toBeNull();
    expect(preferredWorkspaceFromHeader(`hm_workspace=${WS}x`)).toBeNull();
    expect(preferredWorkspaceFromHeader('hm_workspace=%E0%A4%A')).toBeNull();
  });

  it('readCookieFromHeader não confunde prefixo de nome', () => {
    expect(readCookieFromHeader('xhm_session=a; hm_session=b', 'hm_session')).toBe('b');
  });
});

describe('cookie hm_workspace (escrita)', () => {
  const captured: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const res = {
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      captured.push({ name, value, opts });
      return res;
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      captured.push({ name, value: '', opts });
      return res;
    },
  } as unknown as Response;

  beforeEach(() => {
    captured.length = 0;
  });

  it('httpOnly, SameSite=Lax, path /, 30 dias', () => {
    const id = randomUUID();
    setActiveWorkspaceCookie(res, id);
    expect(captured).toEqual([
      {
        name: WORKSPACE_COOKIE,
        value: id,
        opts: expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        }),
      },
    ]);
  });

  it('recusa gravar o que não é UUID (erro de programação, não dado de usuário)', () => {
    expect(() => setActiveWorkspaceCookie(res, 'nope')).toThrow(/UUID/);
    expect(captured).toHaveLength(0);
  });

  it('clear usa o mesmo path do set', () => {
    clearActiveWorkspaceCookie(res);
    expect(captured).toEqual([{ name: WORKSPACE_COOKIE, value: '', opts: { path: '/' } }]);
  });
});

/**
 * Resolução por PESSOA contra o banco de dev: `hm_workspace` só vale com membership
 * `active` do `auth_user_id`; inválido cai na última usada; sem `active` → invalid.
 */
describe('resolveSessionStatus — membership por auth_user_id (DB)', () => {
  const createdWorkspaces: string[] = [];

  beforeEach(() => {
    vi.useRealTimers(); // o pool do Postgres usa timers reais
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of createdWorkspaces) {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
    await closeDb();
  });

  async function workspace(): Promise<string> {
    const sfx = randomUUID().slice(0, 8);
    const [ws] = await getDb()
      .insert(schema.workspaces)
      .values({ name: `Sess ${sfx}`, slug: `sess-${sfx}` })
      .returning({ id: schema.workspaces.id });
    createdWorkspaces.push(ws!.id);
    return ws!.id;
  }

  async function membership(
    workspaceId: string,
    authUserId: string,
    status: 'invited' | 'active' | 'inactive' | 'blocked',
    lastActiveAt: Date | null = null,
  ): Promise<string> {
    const [m] = await getDb()
      .insert(schema.members)
      .values({
        workspaceId,
        authUserId,
        email: `sess-${authUserId.slice(0, 8)}@t.local`,
        role: 'AGENT',
        status,
        lastActiveAt,
      })
      .returning({ id: schema.members.id });
    return m!.id;
  }

  function person(): { identity: AuthIdentity; token: string } {
    const identity = { authUserId: randomUUID(), email: 'p@t.local' };
    verifyTokenMock.mockResolvedValue(identity);
    return { identity, token: `tok-${randomUUID()}` };
  }

  it('sem preferência → empresa de last_active_at mais recente', async () => {
    const { identity, token } = person();
    const a = await workspace();
    const b = await workspace();
    await membership(a, identity.authUserId, 'active', new Date(Date.now() - 2 * 86_400_000));
    const mb = await membership(
      b,
      identity.authUserId,
      'active',
      new Date(Date.now() - 86_400_000),
    );
    const r = await resolveSessionStatus(token);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.session.workspace.id).toBe(b);
      expect(r.session.member.id).toBe(mb);
    }
  });

  it('preferência com membership ativa → resolve nela', async () => {
    const { identity, token } = person();
    const a = await workspace();
    const b = await workspace();
    const ma = await membership(a, identity.authUserId, 'active');
    await membership(b, identity.authUserId, 'active', new Date());
    const r = await resolveSessionStatus(token, a);
    expect(r.kind === 'ok' && r.session.member.id).toBe(ma);
  });

  it('preferência sem membership, inativa ou malformada → ignorada, cai na padrão', async () => {
    const { identity, token } = person();
    const mine = await workspace();
    const gone = await workspace();
    const foreign = await workspace();
    await membership(mine, identity.authUserId, 'active');
    await membership(gone, identity.authUserId, 'inactive', new Date());
    await membership(foreign, randomUUID(), 'active');
    for (const pref of [foreign, gone, 'nao-e-uuid', randomUUID(), null]) {
      const r = await resolveSessionStatus(token, pref);
      expect(r.kind === 'ok' && r.session.workspace.id).toBe(mine);
    }
  });

  it('só memberships invited/inactive/blocked → invalid', async () => {
    const { identity, token } = person();
    await membership(await workspace(), identity.authUserId, 'invited');
    await membership(await workspace(), identity.authUserId, 'inactive');
    const blocked = await workspace();
    await membership(blocked, identity.authUserId, 'blocked');
    expect(await resolveSessionStatus(token)).toEqual({ kind: 'invalid' });
    expect(await resolveSessionStatus(token, blocked)).toEqual({ kind: 'invalid' });
  });

  it('auth_user_id fora do formato UUID → invalid (nem chega ao SQL)', async () => {
    verifyTokenMock.mockResolvedValue({ authUserId: 'u', email: 'u@t.local' });
    expect(await resolveSessionStatus(`tok-${randomUUID()}`)).toEqual({ kind: 'invalid' });
  });
});
