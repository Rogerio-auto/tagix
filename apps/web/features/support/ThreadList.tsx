'use client';

/**
 * Lista de threads de suporte do membro (F38-S09). Estados loading/error/empty.
 */
import { Headset, MessageSquarePlus } from 'lucide-react';
import type { SupportThreadDTO } from '@hm/shared';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState } from '@hm/ui';
import { formatDateTime } from '@/shared/lib/locale';
import { StatusBadge } from './StatusBadge';
import { useSupportThreads } from './queries';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return formatDateTime(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ThreadList({
  onOpen,
  onNew,
  active,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  active: boolean;
}) {
  const { data, isLoading, isError, refetch } = useSupportThreads(active);
  const threads: SupportThreadDTO[] = data?.threads ?? [];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="h-16 rounded-md bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-16 rounded-md bg-surface-2 motion-safe:animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar suas conversas"
        reason="A lista de conversas com o suporte não respondeu."
        whatToDo="Tente de novo em instantes."
        action={
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={Headset}
        title="Nenhuma conversa"
        description="Abra uma conversa com a equipe Leadium quando precisar de ajuda."
        action={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<MessageSquarePlus className="size-4" aria-hidden />}
            onClick={onNew}
          >
            Nova conversa
          </Button>
        }
      />
    );
  }

  return (
    <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
      {threads.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full flex-col gap-1.5 rounded-md border border-transparent px-3 py-3 text-left outline-none transition-colors duration-(--dur-fast) ease-ds hover:border-border hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:focus-ring"
          >
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate font-body text-sm font-bold text-text">{t.subject}</span>
              <StatusBadge status={t.status} />
            </span>
            <span className="font-mono text-xs tabular-nums text-text-low">{formatWhen(t.lastMessageAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
