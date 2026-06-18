'use client';

/**
 * Lista de threads de suporte do membro (F38-S09). Estados loading/error/empty.
 */
import { Headset, MessageSquarePlus } from 'lucide-react';
import type { SupportThreadDTO } from '@hm/shared';
import { Button } from '@hm/ui';
import { EmptyState } from '@/shared/components/feedback';
import { StatusBadge } from './StatusBadge';
import { useSupportThreads } from './queries';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
        <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-danger">Falha ao carregar suas conversas.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={Headset}
        title="Nenhuma conversa"
        description="Abra uma conversa com a equipe Leadium quando precisar de ajuda."
        action={
          <Button variant="primary" size="sm" onClick={onNew}>
            <MessageSquarePlus className="size-4" aria-hidden /> Nova conversa
          </Button>
        }
      />
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto p-2">
      {threads.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md"
          >
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate font-head text-sm font-medium text-text">
                {t.subject}
              </span>
              <StatusBadge status={t.status} />
            </span>
            <span className="font-body text-xs text-text-low">{formatWhen(t.lastMessageAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
