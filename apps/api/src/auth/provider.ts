import type { IAuthProvider } from '@hm/shared';
import { MockAuthProvider } from './mock-provider';
import { SupabaseAuthProvider } from './supabase-provider';

let cached: IAuthProvider | null = null;

function isUsable(value: string | undefined, placeholderHint: string): value is string {
  return Boolean(value && !value.includes(placeholderHint));
}

/** Limpa o provider cacheado (uso em testes — o cache captura env do 1º call). */
export function __resetAuthProviderCache(): void {
  cached = null;
}

/**
 * Escolhe o provider de auth: `AUTH_PROVIDER=mock` força mock (dev local);
 * senão Supabase real se SUPABASE_URL/ANON_KEY válidos; senão MockAuthProvider.
 *
 * SEC-02 (fail-fast): o MockAuthProvider aceita QUALQUER senha e emite token não
 * assinado (base64 do payload) — um interruptor de bypass total. Em produção ele
 * não pode existir: tanto o override explícito (`AUTH_PROVIDER=mock`) quanto o
 * fallback silencioso (chaves Supabase ausentes/placeholder) ABORTAM o boot com
 * erro claro. O `createAuthRouter` resolve o provider na montagem do app, então
 * a falha acontece no boot, não no primeiro request.
 */
export function getAuthProvider(): IAuthProvider {
  if (cached) return cached;

  const isProd = process.env['NODE_ENV'] === 'production';

  // Override explícito p/ dev local: `AUTH_PROVIDER=mock` no .env loga com
  // qualquer senha um member existente (ex. owner@dev.local do seed), mesmo
  // com as chaves Supabase preenchidas. NUNCA em produção (fail-fast).
  if (process.env['AUTH_PROVIDER'] === 'mock') {
    if (isProd) {
      throw new Error(
        '[auth] FATAL: AUTH_PROVIDER=mock em produção. O provider mock aceita qualquer ' +
          'senha (bypass total de autenticação). Remova AUTH_PROVIDER do ambiente e ' +
          'configure SUPABASE_URL/SUPABASE_ANON_KEY.',
      );
    }
    cached = new MockAuthProvider();
    return cached;
  }

  const url = process.env['SUPABASE_URL'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];
  // Service key (server-side) habilita o cadastro self-serve (admin createUser com
  // email_confirm:false). Opcional: sem ela, signUp falha explicitamente (provider_error),
  // nunca cai num caminho inseguro. NUNCA exposta ao cliente.
  const serviceKey = process.env['SUPABASE_SERVICE_KEY'];

  if (isUsable(url, 'your-project') && url.startsWith('https://') && isUsable(anonKey, 'your-anon')) {
    cached = new SupabaseAuthProvider(
      url,
      anonKey,
      isUsable(serviceKey, 'your-service') ? serviceKey : undefined,
    );
  } else {
    if (isProd) {
      throw new Error(
        '[auth] FATAL: produção sem SUPABASE_URL/SUPABASE_ANON_KEY válidos. Recusando ' +
          'o fallback para MockAuthProvider (aceita qualquer senha). Configure as ' +
          'chaves do Supabase no ambiente.',
      );
    }
    cached = new MockAuthProvider();
  }
  return cached;
}
