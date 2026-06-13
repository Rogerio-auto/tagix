'use client';

/**
 * Lista de sessoes view-as ativas (F26-S09) com kill-switch. Consome F26-S05.
 * DS v2 dark-first.
 */
import { Eye, XCircle } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import { useActiveSessions, useEndImpersonation } from './queries';

export function ActiveSessions() {
  const { data, isLoading } = useActiveSessions();
  const end = useEndImpersonation();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-high">View-as ativos</h1>
        <p className="text-sm text-text-mid">
          Sessoes de impersonation em andamento (read-only, time-boxed). Encerre quando terminar.
        </p>
      </header>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : !data || data.sessions.length === 0 ? (
        <p className="text-sm text-text-low">Nenhuma sessao ativa.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-1 p-4"
            >
              <div className="flex items-start gap-3">
                <Eye className="mt-0.5 size-4 text-accent" aria-hidden />
                <div className="flex flex-col text-sm">
                  <span className="text-text-high">Workspace {s.targetWorkspaceId}</span>
                  <span className="text-text-mid">{s.reason}</span>
                  <span className="text-xs text-text-low">
                    iniciada {new Date(s.startedAt).toLocaleString('pt-BR')} · expira{' '}
                    {new Date(s.expiresAt).toLocaleTimeString('pt-BR')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => end.mutate(s.id)}
                disabled={end.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-text-mid hover:text-danger disabled:opacity-50"
              >
                <XCircle className="size-4" aria-hidden /> Encerrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
