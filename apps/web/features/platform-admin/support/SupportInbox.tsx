'use client';

/**
 * Inbox de suporte da plataforma (F38-S11) no DS 3.0 (F72-S08) — triagem cross-workspace
 * da equipe. Filtros (status/prioridade) + fila + detalhe (resposta em tempo real e
 * status/prioridade/atribuição). Consome a API S10 e o socket S08 (inalterados).
 *
 * Desktop (`lg+`): fila e conversa lado a lado. Abaixo disso a conversa abre num `Drawer`
 * (UX §2.3), com a fila sempre à vista atrás.
 *
 * UX: §2.1 clique no item abre a conversa; §2.5 `?`; §2.6 fila vazia e "nenhuma
 * selecionada" explicam o próximo passo; §2.7 skeleton; §2.11 erro em 3 partes.
 */
import { useState } from 'react';
import { Inbox, MessagesSquare } from 'lucide-react';
import type {
  SupportPlatformFilters,
  SupportThreadDTO,
  SupportThreadPriorityT,
  SupportThreadStatusT,
} from '@hm/shared';
import { SUPPORT_THREAD_PRIORITIES, SUPPORT_THREAD_STATUSES } from '@hm/shared';
import { Button, Drawer, EmptyState, ErrorState, Skeleton } from '@hm/ui';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { formatDateTime, formatNumber } from '@/shared/lib/locale';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { controlClass, FieldLabel } from '../ui/kit';
import { InboxThread } from './InboxThread';
import { PRIORITY_LABEL, PriorityBadge, STATUS_LABEL, StatusBadge } from './badges';
import { usePlatformSupportSocket } from './usePlatformSupportSocket';
import { usePlatformThreads } from './queries';

const WHEN: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

export function SupportInbox() {
  const { isBelowDesktop } = useBreakpoint();
  const [filters, setFilters] = useState<SupportPlatformFilters>({});
  const [selected, setSelected] = useState<string | null>(null);
  // Mantém a fila inteira viva mesmo sem thread aberto (room support:platform).
  usePlatformSupportSocket(null);

  const { data, isLoading, isError, isFetching, refetch } = usePlatformThreads(filters);
  const threads: SupportThreadDTO[] = data?.threads ?? [];
  const selectedThread = threads.find((t) => t.id === selected);
  const openCount = threads.filter((t) => t.status === 'open').length;

  const queue = (
    <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-surface lg:w-96 lg:shrink-0">
      <div className="grid grid-cols-2 gap-3 border-b border-border p-3">
        <FieldLabel label="Status">
          <select
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                status: e.target.value === '' ? undefined : (e.target.value as SupportThreadStatusT),
              }))
            }
            className={controlClass}
          >
            <option value="">Todos</option>
            {SUPPORT_THREAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel label="Prioridade">
          <select
            value={filters.priority ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                priority: e.target.value === '' ? undefined : (e.target.value as SupportThreadPriorityT),
              }))
            }
            className={controlClass}
          >
            <option value="">Todas</option>
            {SUPPORT_THREAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </FieldLabel>
      </div>

      {isLoading ? (
        <div role="status" aria-busy="true" aria-label="Carregando a fila" className="flex flex-col gap-2 p-3">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      ) : isError ? (
        <ErrorState
          title="Não foi possível carregar a fila"
          reason="As conversas de suporte não responderam."
          whatToDo="Tente de novo em instantes."
          action={
            <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState
          className="py-10"
          variant="no-results"
          icon={Inbox}
          title="Fila vazia"
          description="Nenhuma conversa de suporte com estes filtros."
        />
      ) : (
        <nav aria-label="Conversas de suporte" className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {threads.map((t) => {
              const active = selected === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1.5 px-4 py-3 text-left outline-none transition-colors duration-(--dur-fast) focus-visible:focus-ring',
                      active
                        ? 'bg-surface-2 shadow-[inset_2px_0_0_var(--brand-text)]'
                        : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-body text-sm font-semibold text-text">
                        {t.subject}
                      </span>
                      <StatusBadge status={t.status} />
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-xs text-text-low">{t.workspaceId}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {t.priority !== 'normal' && <PriorityBadge priority={t.priority} />}
                        <time
                          dateTime={t.lastMessageAt ?? undefined}
                          className="whitespace-nowrap font-mono text-xs tabular-nums text-text-low"
                        >
                          {t.lastMessageAt ? formatDateTime(t.lastMessageAt, WHEN) : ''}
                        </time>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/support"
        title="Suporte"
        description={
          data ? (
            <span>
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(threads.length)}</span>{' '}
              {threads.length === 1 ? 'conversa' : 'conversas'} ·{' '}
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(openCount)}</span>{' '}
              {openCount === 1 ? 'aberta' : 'abertas'}
            </span>
          ) : (
            'Conversas de suporte de todos os workspaces.'
          )
        }
      />

      {isBelowDesktop ? (
        <>
          {queue}
          <Drawer
            open={selected !== null}
            onClose={() => setSelected(null)}
            title={selectedThread?.subject ?? 'Conversa de suporte'}
          >
            {selected && (
              <div className="-mx-5 -my-4 flex h-[70dvh] min-h-0 flex-col">
                <InboxThread key={selected} threadId={selected} compact />
              </div>
            )}
          </Drawer>
        </>
      ) : (
        <div className="flex h-[calc(100dvh-14rem)] min-h-[34rem] gap-4">
          {queue}
          <section
            aria-label="Conversa selecionada"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
          >
            {selected ? (
              <InboxThread key={selected} threadId={selected} />
            ) : (
              <EmptyState
                className="m-auto"
                icon={MessagesSquare}
                title="Nenhuma conversa aberta"
                description="Escolha uma conversa na fila para ler e responder."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
