'use client';

/**
 * Detalhe de um thread no inbox de suporte da plataforma (F38-S11) no DS 3.0 (F72-S08).
 * Mensagens (cliente/equipe), resposta da equipe e controles de status, prioridade e
 * atribuição. Real-time via `usePlatformSupportSocket` (entra no room do thread aberto).
 *
 * Mesmas chamadas de antes (`usePlatformReply`, `usePatchThread`). Visual: bolha da equipe
 * em tinta da marca de texto (não o verde cheio), horários em mono, botão de enviar com
 * nome acessível. `compact`: dentro do Drawer (o título já está no cabeçalho dele).
 *
 * UX: §2.7 botões em carregando; §2.10 Enter envia, Shift+Enter quebra linha;
 * §2.11 erro em 3 partes.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { SupportMessageDTO, SupportThreadPriorityT, SupportThreadStatusT } from '@hm/shared';
import { SUPPORT_THREAD_PRIORITIES, SUPPORT_THREAD_STATUSES } from '@hm/shared';
import { Button, ErrorState, Skeleton } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import { controlClass, textareaClass } from '../ui/kit';
import { PRIORITY_LABEL, PriorityBadge, STATUS_LABEL, StatusBadge } from './badges';
import { usePatchThread, usePlatformReply, usePlatformThread } from './queries';
import { usePlatformSupportSocket } from './usePlatformSupportSocket';

const WHEN: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

export function InboxThread({ threadId, compact = false }: { threadId: string; compact?: boolean }) {
  usePlatformSupportSocket(threadId);
  const { data, isLoading, isError, isFetching, refetch } = usePlatformThread(threadId);
  const reply = usePlatformReply(threadId);
  const patch = usePatchThread(threadId);
  const memberId = useAuthStore((st) => st.auth?.memberId);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const statusId = useId();
  const priorityId = useId();

  const thread = data?.thread;
  const messages: SupportMessageDTO[] = data?.messages ?? [];

  useEffect(() => {
    // `motion-safe` vale para o scroll também: sob movimento reduzido, salta.
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' });
  }, [messages.length]);

  function submit(): void {
    const body = draft.trim();
    if (body === '') return;
    reply.mutate(body, { onSuccess: () => setDraft('') });
  }

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Carregando a conversa" className="flex flex-1 flex-col gap-3 p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-16 w-3/4 rounded-lg" />
        <Skeleton className="ml-auto h-16 w-2/3 rounded-lg" />
      </div>
    );
  }
  if (isError || !thread) {
    return (
      <div className="flex flex-1 items-center justify-center p-5">
        <ErrorState
          title="Não foi possível abrir a conversa"
          reason="O histórico deste thread não respondeu."
          whatToDo="Tente de novo em instantes."
          action={
            <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
        {!compact && (
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate font-head text-base font-semibold text-text">{thread.subject}</h2>
            <StatusBadge status={thread.status} />
            <PriorityBadge priority={thread.priority} />
          </div>
        )}
        <p className="font-body text-sm text-text-low">
          Workspace <span className="font-mono text-text-mid">{thread.workspaceId}</span>
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={statusId} className="font-body text-xs font-bold text-text-mid">
              Status
            </label>
            <select
              id={statusId}
              value={thread.status}
              onChange={(e) => patch.mutate({ status: e.target.value as SupportThreadStatusT })}
              className={cn(controlClass, 'h-9 w-auto')}
            >
              {SUPPORT_THREAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={priorityId} className="font-body text-xs font-bold text-text-mid">
              Prioridade
            </label>
            <select
              id={priorityId}
              value={thread.priority}
              onChange={(e) => patch.mutate({ priority: e.target.value as SupportThreadPriorityT })}
              className={cn(controlClass, 'h-9 w-auto')}
            >
              {SUPPORT_THREAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <span className="ml-auto flex items-center gap-2">
            {thread.assignedTo ? (
              <>
                <span className="font-body text-sm text-text-low">
                  Atribuída a{' '}
                  <span className="font-mono text-text-mid">
                    {thread.assignedTo === memberId ? 'você' : thread.assignedTo}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={patch.isPending}
                  onClick={() => patch.mutate({ assignedTo: null })}
                  aria-label="Desatribuir conversa"
                >
                  Desatribuir
                </Button>
              </>
            ) : (
              <>
                <span className="font-body text-sm text-text-low">Sem responsável</span>
                {memberId ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={patch.isPending}
                    onClick={() => patch.mutate({ assignedTo: memberId })}
                    aria-label="Atribuir conversa a mim"
                  >
                    Atribuir a mim
                  </Button>
                ) : null}
              </>
            )}
          </span>
        </div>
      </div>

      <div
        role="log"
        aria-label="Mensagens"
        // Região rolável focável: o teclado também rola o histórico (axe scrollable-region-focusable).
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4 outline-none focus-visible:focus-ring"
      >
        <ul className="flex flex-col gap-3">
          {messages.map((m) => {
            const fromPlatform = m.senderType === 'platform';
            return (
              <li key={m.id} className={cn('flex flex-col', fromPlatform ? 'items-end' : 'items-start')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg border px-3.5 py-2.5',
                    fromPlatform
                      ? 'rounded-br-xs border-brand-text/20 bg-brand-text/10'
                      : 'rounded-bl-xs border-border bg-surface-2',
                  )}
                >
                  <span className="mb-1 block font-mono text-[0.6875rem] font-semibold uppercase tracking-widest text-text-mid">
                    {fromPlatform ? 'Equipe' : 'Cliente'}
                  </span>
                  <span className="whitespace-pre-wrap break-words font-body text-sm text-text">{m.body}</span>
                </div>
                {m.createdAt && (
                  <time dateTime={m.createdAt} className="mt-1 font-mono text-xs tabular-nums text-text-low">
                    {formatDateTime(m.createdAt, WHEN)}
                  </time>
                )}
              </li>
            );
          })}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Responder ao cliente…"
            aria-label="Resposta da equipe"
            className={cn(textareaClass, 'max-h-32 min-h-10 flex-1 resize-none')}
          />
          <Button
            type="submit"
            variant="primary"
            loading={reply.isPending}
            disabled={draft.trim() === ''}
            aria-label="Enviar resposta"
            leftIcon={<Send className="size-4" aria-hidden />}
          >
            <span className="max-sm:sr-only">Enviar</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
