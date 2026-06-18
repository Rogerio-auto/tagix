'use client';

/**
 * Inbox de suporte da plataforma (F38-S11) — triagem cross-workspace da equipe
 * Leadium. Filtros (status/priority) + lista + detalhe (reply real-time +
 * status/priority/assign). Consome a API S10 e o socket S08. DS v2, ARIA.
 */
import { useState } from 'react';
import { Headset, Inbox } from 'lucide-react';
import type {
  SupportPlatformFilters,
  SupportThreadDTO,
  SupportThreadPriorityT,
  SupportThreadStatusT,
} from '@hm/shared';
import { SUPPORT_THREAD_PRIORITIES, SUPPORT_THREAD_STATUSES } from '@hm/shared';
import { EmptyState } from '@/shared/components/feedback';
import { InboxThread } from './InboxThread';
import { PriorityBadge, StatusBadge } from './badges';
import { usePlatformSupportSocket } from './usePlatformSupportSocket';
import { usePlatformThreads } from './queries';

const STATUS_LABEL: Record<SupportThreadStatusT, string> = {
  open: 'Aberto',
  pending: 'Aguardando',
  resolved: 'Resolvido',
};
const PRIORITY_LABEL: Record<SupportThreadPriorityT, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
};
const ctrlCls =
  'rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-body text-sm text-text outline-none focus-visible:border-border-2 focus-visible:shadow-glow-md';

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SupportInbox() {
  const [filters, setFilters] = useState<SupportPlatformFilters>({});
  const [selected, setSelected] = useState<string | null>(null);
  // Mantem a fila inteira viva mesmo sem thread aberto (room support:platform).
  usePlatformSupportSocket(null);

  const { data, isLoading, isError, refetch } = usePlatformThreads(filters);
  const threads: SupportThreadDTO[] = data?.threads ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-md bg-surface-2 text-text-mid">
          <Headset className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="font-head text-2xl font-semibold text-text">Suporte</h1>
          <p className="font-body text-sm text-text-mid">
            Conversas de suporte de todos os workspaces do Leadium.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-text-low">
          Status
          <select
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                status:
                  e.target.value === '' ? undefined : (e.target.value as SupportThreadStatusT),
              }))
            }
            className={ctrlCls}
            aria-label="Filtrar por status"
          >
            <option value="">Todos</option>
            {SUPPORT_THREAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-low">
          Prioridade
          <select
            value={filters.priority ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                priority:
                  e.target.value === '' ? undefined : (e.target.value as SupportThreadPriorityT),
              }))
            }
            className={ctrlCls}
            aria-label="Filtrar por prioridade"
          >
            <option value="">Todas</option>
            {SUPPORT_THREAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-h-[60vh] flex-col gap-4 lg:flex-row">
        <div className="flex w-full flex-col rounded-lg border border-border-2 lg:w-96 lg:shrink-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-3">
              <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
              <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
            </div>
          )}
          {isError && (
            <div className="p-6 text-center">
              <p className="text-sm text-danger">Falha ao carregar a fila.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-2 font-head text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:shadow-glow-md"
              >
                Tentar novamente
              </button>
            </div>
          )}
          {!isLoading && !isError && threads.length === 0 && (
            <EmptyState
              icon={Inbox}
              title="Fila vazia"
              description="Nenhuma conversa de suporte com estes filtros."
            />
          )}
          <ul className="flex-1 overflow-y-auto p-2">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t.id)}
                  aria-current={selected === t.id ? 'true' : undefined}
                  className={
                    selected === t.id
                      ? 'flex w-full flex-col gap-1 rounded-lg border border-border-2 bg-surface-3 px-3 py-3 text-left outline-none focus-visible:shadow-glow-md'
                      : 'flex w-full flex-col gap-1 rounded-lg border border-transparent px-3 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:shadow-glow-md'
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="flex-1 truncate font-head text-sm font-medium text-text">
                      {t.subject}
                    </span>
                    <StatusBadge status={t.status} />
                    <PriorityBadge priority={t.priority} />
                  </span>
                  <span className="truncate font-body text-[11px] text-text-low">
                    {t.workspaceId} - {when(t.lastMessageAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border-2">
          {selected ? (
            <InboxThread key={selected} threadId={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
              <p className="max-w-sm font-body text-sm text-text-low">
                Selecione uma conversa na fila para atender.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
