/**
 * Verificação de token resiliente (fix do handshake flaky do socket). Cobre: cache
 * fresh evita rede; stale-on-error serve o último bom numa falha transitória do
 * provider; além do stale → null; token forjado (nunca visto) → null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthIdentity } from '@hm/shared';

const verifyTokenMock = vi.fn<(token: string) => Promise<AuthIdentity | null>>();
vi.mock('./provider', () => ({
  getAuthProvider: () => ({ verifyToken: verifyTokenMock }),
}));

const { verifyTokenResilient, __resetIdentityCache } = await import('./session');

const ID: AuthIdentity = { authUserId: 'u1', email: 'a@b.com' };

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

  it('stale-on-error: fresh expirou e o provider falha → serve o último bom', async () => {
    verifyTokenMock.mockResolvedValueOnce(ID);
    await verifyTokenResilient('tok'); // sucesso @0
    vi.setSystemTime(6 * 60_000); // +6min (fresh 5min expirou)
    verifyTokenMock.mockResolvedValueOnce(null); // blip transitório do provider
    expect(await verifyTokenResilient('tok')).toEqual(ID); // não rejeita
    expect(verifyTokenMock).toHaveBeenCalledTimes(2);
  });

  it('além do stale (15min) com provider falhando → null', async () => {
    verifyTokenMock.mockResolvedValueOnce(ID);
    await verifyTokenResilient('tok'); // @0
    vi.setSystemTime(16 * 60_000); // +16min (> stale 15min)
    verifyTokenMock.mockResolvedValueOnce(null);
    expect(await verifyTokenResilient('tok')).toBeNull();
  });

  it('token nunca-visto que falha → null (não inventa sessão)', async () => {
    verifyTokenMock.mockResolvedValue(null);
    expect(await verifyTokenResilient('forjado')).toBeNull();
  });
});
