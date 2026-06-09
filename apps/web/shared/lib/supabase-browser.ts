'use client';

import type { SessionUser } from './session';

/**
 * STUB de sessão client-side. Substituído pelo cliente Supabase real no slot de
 * auth backend (F0-S05). Hoje o estado de auth client vem do `auth.store`.
 */
export function getBrowserSession(): SessionUser | null {
  return null;
}
