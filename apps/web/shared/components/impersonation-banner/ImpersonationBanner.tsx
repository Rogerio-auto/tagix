'use client';

/**
 * Banner global de view-as (F26-S09) -- persistente e INESCAPAVEL enquanto a sessao
 * de impersonation esta ativa. Cor distinta (accent), indica READ-ONLY e oferece "Sair"
 * 1-clique sempre visivel (UX: nao-esconder, 2.7 feedback). Montado no (app)/layout
 * quando ha cookie de impersonation. Consome F26-S05 (lista + encerrar).
 */
import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { useWorkspaceSwitcher } from '@/shared/components/workspace-switcher';
import {
  useActiveSessions,
  useEndImpersonation,
} from '@/features/platform-admin/impersonation/queries';

export function ImpersonationBanner() {
  const { data } = useActiveSessions();
  const end = useEndImpersonation();
  const router = useRouter();
  const { activeName } = useWorkspaceSwitcher();

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
    <div
      role="status"
      data-banner="impersonation"
      className="sticky top-0 z-[60] shrink-0 border-b border-violet/40 bg-violet/10 pt-safe text-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 md:px-8">
        <span className="flex min-w-0 items-center gap-2 font-head font-medium text-violet">
          <Eye className="size-4" aria-hidden />
          <span className="truncate">
            Vendo como {activeName ? `a empresa ${activeName}` : 'a empresa selecionada'} ·{' '}
            <span className="font-semibold">somente leitura</span>
          </span>
        </span>
        <button
          type="button"
          onClick={exit}
          disabled={end.isPending}
          aria-busy={end.isPending}
          className="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-violet/50 bg-surface px-3 font-head text-xs font-semibold text-text outline-none transition-colors duration-150 after:absolute after:-inset-1.5 hover:bg-surface-2 focus-visible:focus-ring disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
        >
          <LogOut className="size-3.5" aria-hidden /> {end.isPending ? 'Saindo…' : 'Sair'}
        </button>
      </div>
    </div>
  );
}
