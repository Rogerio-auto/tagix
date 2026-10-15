'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronRight, X } from 'lucide-react';
import { useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
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
 * por construção. Alvos ≥ 44px (`touch-target`). "Concluir" é escrita: em empresa só
 * leitura fica `aria-disabled` com a explicação (F72-S07); "Descartar" é local.
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
        'relative rounded-md border p-3 transition-colors duration-(--dur-fast) ease-ds',
        n.seen ? 'border-border bg-surface' : 'border-border-2 bg-surface-2',
        hasConversation && 'hover:border-border-brand',
      )}
    >
      {/* Overlay: alvo da ação primária (abrir conversa). Fica ATRÁS do conteúdo. */}
      {hasConversation && (
        <button
          type="button"
          onClick={openConversation}
          aria-label={`Abrir conversa — ${n.title}`}
          className="absolute inset-0 z-0 rounded-md outline-none focus-visible:focus-ring"
        />
      )}

      <div className="pointer-events-none relative z-10 flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn('mt-1.5 size-2 shrink-0 rounded-pill', priorityDotClass(n.priority))}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
              {eventTypeLabel(n.type)}
            </span>
            <span className="font-mono text-xs tabular-nums text-text-low">
              · {formatStartAt(n.startAt)}
            </span>
            <span className="sr-only">Prioridade {priorityLabel(n.priority)}</span>
          </div>
          <p className="mt-1 truncate font-body text-sm font-bold text-text">{n.title}</p>

          {/* Uma linha só: a dica (decorativa; o overlay já se anuncia) encolhe e as duas
              ações secundárias ficam juntas à direita, reabilitando o ponteiro acima do overlay. */}
          <div className="mt-2 flex flex-nowrap items-center gap-1.5">
            {hasConversation && (
              <span
                aria-hidden
                className="inline-flex min-w-0 items-center gap-1 font-body text-xs text-text-low"
              >
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">Abrir conversa</span>
              </span>
            )}
            <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1.5">
              <ReadOnlyGuard>
                <button
                  type="button"
                  onClick={() => void onComplete()}
                  disabled={complete.isPending}
                  aria-busy={complete.isPending || undefined}
                  className="touch-target inline-flex items-center gap-1.5 rounded-sm px-2 font-body text-xs font-bold text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-3 hover:text-text focus-visible:focus-ring disabled:opacity-60"
                >
                  <Check className="size-3.5" aria-hidden />
                  {complete.isPending ? 'Concluindo…' : 'Concluir'}
                </button>
              </ReadOnlyGuard>
              <button
                type="button"
                onClick={() => remove(n.eventId)}
                aria-label={`Descartar notificação — ${n.title}`}
                className="touch-target inline-flex items-center gap-1.5 rounded-sm px-2 font-body text-xs font-bold text-text-low outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-3 hover:text-text focus-visible:focus-ring"
              >
                <X className="size-3.5" aria-hidden />
                Descartar
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
