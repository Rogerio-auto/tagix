/**
 * SEC-08 — contrato do `verifyToken` do SupabaseAuthProvider:
 *  - `null` SÓ para token genuinamente inválido (erro de API não-retryable);
 *  - LANÇA `AuthProviderUnavailableError` para indisponibilidade (fetch rejeitou
 *    ou 502/503/504 retryable) — permitindo à camada resiliente servir stale.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as SupabaseModule from '@supabase/supabase-js';

const getUserMock = vi.fn<() => Promise<unknown>>();

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof SupabaseModule>();
  return {
    ...actual,
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
  };
});

const { AuthApiError, AuthRetryableFetchError } = await import('@supabase/supabase-js');
const { SupabaseAuthProvider, AuthProviderUnavailableError } = await import('./supabase-provider');

function makeProvider() {
  return new SupabaseAuthProvider('https://abc123.supabase.co', 'anon-key');
}

afterEach(() => {
  getUserMock.mockReset();
});

describe('SupabaseAuthProvider.verifyToken (SEC-08)', () => {
  it('usuário válido → identidade', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.com' } },
      error: null,
    });
    await expect(makeProvider().verifyToken('tok')).resolves.toEqual({
      authUserId: 'u1',
      email: 'a@b.com',
    });
  });

  it('erro de API (token expirado/revogado, 401) → null (invalidação definitiva)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('invalid JWT: token is expired', 401, 'bad_jwt'),
    });
    await expect(makeProvider().verifyToken('tok')).resolves.toBeNull();
  });

  it('erro retryable (rede/5xx) → LANÇA AuthProviderUnavailableError', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    });
    await expect(makeProvider().verifyToken('tok')).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it('getUser rejeita (throw inesperado) → LANÇA AuthProviderUnavailableError', async () => {
    getUserMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(makeProvider().verifyToken('tok')).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it('sem user e sem erro (resposta anômala) → null', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(makeProvider().verifyToken('tok')).resolves.toBeNull();
  });
});
