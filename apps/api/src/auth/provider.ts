import type { IAuthProvider } from '@hm/shared';
import { MockAuthProvider } from './mock-provider';
import { SupabaseAuthProvider } from './supabase-provider';

let cached: IAuthProvider | null = null;

function isUsable(value: string | undefined, placeholderHint: string): value is string {
  return Boolean(value && !value.includes(placeholderHint));
}

/**
 * Escolhe o provider de auth: `AUTH_PROVIDER=mock` força mock (dev local);
 * senão Supabase real se SUPABASE_URL/ANON_KEY válidos; senão MockAuthProvider.
 */
export function getAuthProvider(): IAuthProvider {
  if (cached) return cached;

  // Override explícito p/ dev local: `AUTH_PROVIDER=mock` no .env loga com
  // qualquer senha um member existente (ex. owner@dev.local do seed), mesmo
  // com as chaves Supabase preenchidas. Nunca usar em produção.
  if (process.env['AUTH_PROVIDER'] === 'mock') {
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
    cached = new MockAuthProvider();
  }
  return cached;
}
