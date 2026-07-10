/**
 * Verificação de token resiliente (fix do handshake flaky do socket + SEC-08).
 * Contrato: cache fresh evita rede; stale-on-error SÓ quando o provider LANÇA
 * (indisponibilidade de infra); `null` do provider = token genuinamente inválido
 * (expirado/revogado) → rejeição imediata + purga do cache, NUNCA stale; token
 * forjado (nunca visto) → null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthIdentity } from '@hm/shared';

const verifyTokenMock = vi.fn<(token: string) => Promise<AuthIdentity | null>>();
vi.mock('./provider', () => ({
  getAuthProvider: () => ({ verifyToken: verifyTokenMock }),
}));

const { verifyTokenResilient, __resetIdentityCache } = await import('./session');

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
