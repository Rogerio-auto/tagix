'use client';

/**
 * Pagina de view-as (F26-S09): quando ha ?workspace= (vindo do 360), oferece o
 * "Ver como" pre-direcionado; sempre lista as sessoes ativas com kill-switch.
 */
import { useSearchParams } from 'next/navigation';
import { ActiveSessions } from './ActiveSessions';
import { ViewAsButton } from './ViewAsButton';

export function ImpersonationView() {
  const params = useSearchParams();
  const workspaceId = params.get('workspace');

  return (
    <div className="flex flex-col gap-8">
      {workspaceId && (
        <section className="flex items-center justify-between gap-4 rounded-xl border border-accent/40 bg-accent/5 p-5">
          <div className="flex flex-col text-sm">
            <span className="font-medium text-text-high">Iniciar view-as deste tenant</span>
            <span className="text-text-mid">Workspace {workspaceId} · sessao read-only, com motivo e TTL.</span>
          </div>
          <ViewAsButton workspaceId={workspaceId} />
        </section>
      )}
      <ActiveSessions />
    </div>
  );
}
