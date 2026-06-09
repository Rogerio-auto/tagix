import type { IAuthProvider } from '@hm/shared';
import { MockAuthProvider } from './mock-provider';
import { SupabaseAuthProvider } from './supabase-provider';

let cached: IAuthProvider | null = null;

function isUsable(value: string | undefined, placeholderHint: string): value is string {
  return Boolean(value && !value.includes(placeholderHint));
}

/**
 * Escolhe o provider de auth: Supabase real se SUPABASE_URL/ANON_KEY estiverem
 * preenchidos no .env (não placeholders); senão, MockAuthProvider (dev).
 */
export function getAuthProvider(): IAuthProvider {
  if (cached) return cached;
  const url = process.env['SUPABASE_URL'];
  const anonKey = process.env['SUPABASE_ANON_KEY'];

  if (isUsable(url, 'your-project') && url.startsWith('https://') && isUsable(anonKey, 'your-anon')) {
    cached = new SupabaseAuthProvider(url, anonKey);
  } else {
    cached = new MockAuthProvider();
  }
  return cached;
}
