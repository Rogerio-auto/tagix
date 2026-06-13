import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { resolvePlatformAdmin } from '@/features/platform-admin/lib';
import { PlatformShell } from '@/features/platform-admin/shell';

/**
 * Layout do route group `(platform)` — painel de super-admin (F25-S06).
 *
 * Guard server-side: resolve o member real via `/api/me` e redireciona quem NÃO é
 * `is_platform_admin`. Defesa em profundidade junto ao edge (`middleware.ts`) e à
 * API (`requirePlatformAdmin`, S01). Separado do app de workspace por design.
 */
export const metadata = { title: 'Plataforma' };

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const admin = await resolvePlatformAdmin();
  // Não-admin (ou sessão inválida) volta ao app de workspace, não vaza a existência da área.
  if (!admin) redirect('/');
  return <PlatformShell admin={admin}>{children}</PlatformShell>;
}
