'use client';

/**
 * View de chat de um thread de suporte (F38-S09). Mensagens em tempo real (S08
 * via useSupportSocket), envio, e acao de resolver. Bolhas alinhadas por
 * sender_type (member = direita/brand, platform = esquerda/surface).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Send } from 'lucide-react';
import type { SupportMessageDTO } from '@hm/shared';
import { Button } from '@hm/ui';
import { StatusBadge } from './StatusBadge';
import { useResolveThread, useSendMessage, useSupportThread } from './queries';
import { useSupportSocket } from './useSupportSocket';

function timeOf(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function ThreadView({ threadId }: { threadId: string }) {
  useSupportSocket(threadId);
  const { data, isLoading, isError, refetch } = useSupportThread(threadId);
  const send = useSendMessage(threadId);
  const resolve = useResolveThread(threadId);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const messages: SupportMessageDTO[] = data?.messages ?? [];
  const thread = data?.thread;
  const resolved = thread?.status === 'resolved';

  // Auto-scroll ao chegar mensagem nova.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function submit(): void {
    const body = draft.trim();
    if (body === '') return;
    send.mutate(body, { onSuccess: () => setDraft('') });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {thread && (
        <div className="flex items-center gap-2 border-b border-border-2 px-4 py-2.5">
          <span className="flex-1 truncate font-head text-sm font-medium text-text">
            {thread.subject}
          </span>
          <StatusBadge status={thread.status} />
          {!resolved && (
            <Button
              variant="ghost"
              size="sm"
              loading={resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              <Check className="size-4" aria-hidden /> Resolver
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Mensagens">
        {isLoading && (
          <div className="flex flex-col gap-3">
            <div className="h-10 w-2/3 animate-pulse rounded-lg bg-surface-2" />
            <div className="ml-auto h-10 w-1/2 animate-pulse rounded-lg bg-surface-2" />
          </div>
        )}
        {isError && (
          <div className="text-center">
            <p className="text-sm text-danger">Falha ao carregar a conversa.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-2 font-head text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:shadow-glow-md"
            >
              Tentar novamente
            </button>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map((m) => {
            const mine = m.senderType === 'member';
            return (
              <li
                key={m.id}
                className={mine ? 'flex flex-col items-end' : 'flex flex-col items-start'}
              >
                <div
                  className={
                    mine
                      ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-text-on-brand'
                      : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-surface-2 px-3.5 py-2 text-text'
                  }
                >
                  {!mine && (
                    <span className="mb-0.5 block font-head text-[11px] font-semibold uppercase tracking-wide text-text-low">
                      Equipe Leadium
                    </span>
                  )}
                  <span className="whitespace-pre-wrap break-words font-body text-sm">{m.body}</span>
                </div>
                <span className="mt-0.5 font-body text-[11px] text-text-low">
                  {timeOf(m.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="border-t border-border-2 p-3">
        {resolved ? (
          <p className="text-center font-body text-sm text-text-low">
            Esta conversa foi resolvida. Abra uma nova se precisar de mais ajuda.
          </p>
        ) : (
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
              placeholder="Escreva uma mensagem..."
              aria-label="Mensagem para o suporte"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 font-body text-sm text-text outline-none transition-colors placeholder:text-text-low focus-visible:border-border-2 focus-visible:shadow-glow-md"
            />
            <Button type="submit" variant="primary" size="sm" loading={send.isPending} disabled={draft.trim() === ''}>
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
