'use client';

/**
 * Banner global de view-as (F26-S09) -- persistente e INESCAPAVEL enquanto a sessao
 * de impersonation esta ativa. Cor distinta (accent), indica READ-ONLY e oferece "Sair"
 * 1-clique sempre visivel (UX: nao-esconder, 2.7 feedback). Montado no (app)/layout
 * quando ha cookie de impersonation. Consome F26-S05 (lista + encerrar).
 */
import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { useActiveSessions, useEndImpersonation } from '@/features/platform-admin/impersonation/queries';

export function ImpersonationBanner() {
  const { data } = useActiveSessions();
  const end = useEndImpersonation();
  const router = useRouter();

  // A sessao ativa mais recente e a corrente (o cookie aponta para ela).
  const session = data?.sessions[0];
  if (!session) return null;

  async function exit() {
    if (!session) return;
    await end.mutateAsync(session.id);
    router.push('/platform/tenants');
    router.refresh();
  }

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-between gap-3 border-b border-accent/50 bg-accent/15 px-4 py-2 text-sm">
      <span className="flex items-center gap-2 font-medium text-accent">
        <Eye className="size-4" aria-hidden />
        Vendo como workspace {session.targetWorkspaceId} · <span className="font-semibold">read-only</span>
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={end.isPending}
        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-surface-0 hover:opacity-90 disabled:opacity-50"
      >
        <LogOut className="size-3.5" aria-hidden /> Sair
      </button>
    </div>
  );
}
