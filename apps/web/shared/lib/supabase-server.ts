import { cookies } from 'next/headers';
import { SESSION_COOKIE, type SessionUser } from './session';

/**
 * STUB de sessão server-side. Lê apenas a PRESENÇA do cookie de sessão.
 *
 * TODO(auth F0-S05/S06): validar o JWT via IAuthProvider/Supabase e derivar
 * member + workspace + role reais. Por ora, cookie presente = sessão fake — o
 * suficiente para o gate de rota do shell funcionar.
 */
export async function getServerSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return { memberId: 'stub-member', workspaceId: 'stub-workspace' };
}
