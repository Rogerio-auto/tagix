/**
 * Guard server-side da camada de plataforma (F25-S06).
 *
 * `getServerSession()` é stub (não expõe role/isPlatformAdmin), então resolvemos o
 * member real chamando `GET /api/me` na API, encaminhando o cookie de sessão (RSC
 * não propaga cookie automaticamente). Retorna o member quando é platform admin;
 * `null` caso contrário. O layout `(platform)` usa isto para `redirect()`.
 *
 * Defesa em profundidade: o `middleware.ts` barra no edge (presença de sessão), o
 * layout barra server-side (privilégio real), e a API barra de novo (`requirePlatformAdmin`).
 */
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/shared/lib/session';
import type { PlatformAdminMe } from './types';

const API_BASE =
  process.env['NEXT_PUBLIC_API_URL'] ?? process.env['API_INTERNAL_URL'] ?? 'http://localhost:3001';

/** Resolve o member autenticado se for platform admin; senão `null`. */
export async function resolvePlatformAdmin(): Promise<PlatformAdminMe | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = (await res.json()) as { member?: PlatformAdminMe };
  const member = data.member;
  if (!member?.isPlatformAdmin) return null;
  return member;
}
