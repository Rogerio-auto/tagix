'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronRight, X } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { useNotificationsStore } from './store';
import { useCompleteEvent } from './queries';
import { eventTypeLabel, formatStartAt, priorityDotClass, priorityLabel } from './labels';
import type { AppNotification } from './types';

/**
 * Um item da central (F53-S06).
 *
 * UX §2.1 — a AÇÃO PRIMÁRIA é o clique no corpo do card: abre a conversa de origem
 * (`/conversations/:id`). Implementado com um botão-overlay atrás do conteúdo; as
 * ações secundárias (concluir / descartar) ficam acima (pointer-events reabilitado),
 * então clicar no card abre a conversa e clicar num ícone executa a ação dele.
 *
 * Sem hex; sem neon repetido (a cor da prioridade vem de tokens danger/warning/info).
 * Destaque de "não-lida" é estático (fundo elevado) — respeita prefers-reduced-motion
 * por construção. Alvos ≥ 44px (`touch-target`).
 */
export function NotificationItem({ n }: { n: AppNotification }): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const remove = useNotificationsStore((s) => s.remove);
  const setOpen = useNotificationsStore((s) => s.setOpen);
  const complete = useCompleteEvent();

  const hasConversation = Boolean(n.conversationId);

  const openConversation = (): void => {
    if (!n.conversationId) return;
    setOpen(false);
    router.push(`/conversations/${n.conversationId}`);
  };

  const onComplete = async (): Promise<void> => {
    try {
      await complete.mutateAsync(n.eventId);
      remove(n.eventId);
      toast({ variant: 'success', title: 'Compromisso concluído.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao concluir.' });
    }
  };

  return (
    <li
      className={cn(
        'relative rounded-md border border-border p-3 transition-colors',
        n.seen ? 'bg-surface' : 'bg-surface-2',
        hasConversation && 'hover:border-border-2',
      )}
    >
      {/* Overlay: alvo da ação primária (abrir conversa). Fica ATRÁS do conteúdo. */}
      {hasConversation && (
        <button
          type="button"
          onClick={openConversation}
          aria-label={`Abrir conversa — ${n.title}`}
          className="absolute inset-0 z-0 rounded-md outline-none focus-visible:shadow-glow-md"
        />
      )}

      <div className="pointer-events-none relative z-10 flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn('mt-1.5 size-2 shrink-0 rounded-pill', priorityDotClass(n.priority))}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-head text-xs font-semibold uppercase tracking-wide text-text-low">
              {eventTypeLabel(n.type)}
            </span>
            <span className="text-xs text-text-low">· {formatStartAt(n.startAt)}</span>
            <span className="sr-only">Prioridade {priorityLabel(n.priority)}</span>
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-text">{n.title}</p>

          {/* Ações secundárias — reabilitam o ponteiro acima do overlay. */}
          <div className="pointer-events-auto mt-2 flex flex-wrap items-center gap-1.5">
            {hasConversation && (
              <span className="inline-flex items-center gap-1 text-xs text-text-low">
                <ChevronRight className="size-3.5" />
                Toque para abrir a conversa
              </span>
            )}
            <button
              type="button"
              onClick={() => void onComplete()}
              disabled={complete.isPending}
              className="touch-target ml-auto inline-flex items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-text-mid outline-none transition-colors hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md disabled:opacity-60"
            >
              <Check className="size-3.5" />
              {complete.isPending ? 'Concluindo…' : 'Concluir'}
            </button>
            <button
              type="button"
              onClick={() => remove(n.eventId)}
              aria-label={`Descartar notificação — ${n.title}`}
              className="touch-target inline-flex items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-text-low outline-none transition-colors hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md"
            >
              <X className="size-3.5" />
              Descartar
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
