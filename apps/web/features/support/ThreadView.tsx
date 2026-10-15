'use client';

/**
 * View de chat de um thread de suporte (F38-S09). Mensagens em tempo real (S08
 * via useSupportSocket), envio, e acao de resolver. Bolhas alinhadas por
 * sender_type (member = direita/tinta de marca, platform = esquerda/surface) — o mesmo
 * desenho das bolhas da inbox (DS 3.0: neon cheio nunca vira fundo de mensagem).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Send } from 'lucide-react';
import type { SupportMessageDTO } from '@hm/shared';
import { Button, IconButton } from '@hm/ui';
import { formatTime } from '@/shared/lib/locale';
import { StatusBadge } from './StatusBadge';
import { useResolveThread, useSendMessage, useSupportThread } from './queries';
import { useSupportSocket } from './useSupportSocket';

function timeOf(iso: string | null): string {
  if (!iso) return '';
  return formatTime(iso);
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
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex-1 truncate font-body text-sm font-bold text-text">
            {thread.subject}
          </span>
          <StatusBadge status={thread.status} />
          {!resolved && (
            <Button
              variant="ghost"
              size="sm"
              loading={resolve.isPending}
              leftIcon={<Check className="size-4" aria-hidden />}
              onClick={() => resolve.mutate()}
            >
              Resolver
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Mensagens">
        {isLoading && (
          <div className="flex flex-col gap-3">
            <div className="h-10 w-2/3 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
            <div className="ml-auto h-10 w-1/2 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
          </div>
        )}
        {isError && (
          <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="font-head text-base font-semibold text-text">Não foi possível carregar a conversa.</p>
            <p className="font-body text-sm text-text-mid">Verifique a conexão e tente de novo.</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
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
                      ? 'max-w-[80%] rounded-lg rounded-br-xs border border-brand-text/20 bg-brand-text/10 px-3.5 py-2 text-text'
                      : 'max-w-[80%] rounded-lg rounded-bl-xs border border-border bg-surface-2 px-3.5 py-2 text-text'
                  }
                >
                  {!mine && (
                    <span className="mb-0.5 block font-mono text-xs font-medium uppercase tracking-wider text-text-low">
                      Equipe Leadium
                    </span>
                  )}
                  <span className="whitespace-pre-wrap break-words font-body text-sm">{m.body}</span>
                </div>
                <span className="mt-1 font-mono text-xs tabular-nums text-text-low">
                  {timeOf(m.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
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
              className="max-h-32 min-h-10 flex-1 resize-none rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds placeholder:text-text-low hover:border-border-2 focus:border-brand-text focus-visible:focus-ring sm:text-sm"
            />
            <IconButton
              type="submit"
              variant="solid"
              aria-label="Enviar mensagem ao suporte"
              icon={<Send aria-hidden />}
              loading={send.isPending}
              disabled={draft.trim() === ''}
            />
          </form>
        )}
      </div>
    </div>
  );
}
