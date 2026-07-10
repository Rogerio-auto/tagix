/**
 * SEC-02: o interruptor de bypass (MockAuthProvider, aceita qualquer senha) não
 * pode existir em produção — nem por override explícito (AUTH_PROVIDER=mock) nem
 * por fallback silencioso (chaves Supabase ausentes/placeholder). Fail-fast.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { getAuthProvider, __resetAuthProviderCache } from './provider';

afterEach(() => {
  vi.unstubAllEnvs();
  __resetAuthProviderCache();
});

describe('getAuthProvider — fail-fast em produção (SEC-02)', () => {
  it('produção + AUTH_PROVIDER=mock → lança erro claro no boot', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_PROVIDER', 'mock');
    expect(() => getAuthProvider()).toThrowError(/AUTH_PROVIDER=mock em produção/);
  });

  it('produção sem chaves Supabase válidas → lança (recusa fallback para mock)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('SUPABASE_URL', 'https://your-project.supabase.co'); // placeholder
    vi.stubEnv('SUPABASE_ANON_KEY', 'your-anon-key');
    expect(() => getAuthProvider()).toThrowError(/Recusando/);
  });

  it('produção com chaves Supabase válidas → SupabaseAuthProvider', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('SUPABASE_URL', 'https://abc123.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key-real');
    expect(getAuthProvider().kind).toBe('supabase');
  });

  it('fora de produção AUTH_PROVIDER=mock segue permitido (dev local)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_PROVIDER', 'mock');
    expect(getAuthProvider().kind).toBe('mock');
  });

  it('fora de produção sem chaves → fallback mock (dev sem Supabase)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    expect(getAuthProvider().kind).toBe('mock');
  });
});
