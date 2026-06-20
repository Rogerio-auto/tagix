'use client';

/**
 * Detalhe de um thread no inbox de suporte da plataforma (F38-S11). Mensagens
 * (member/platform), reply da equipe, e controles status/priority/assign.
 * Real-time via usePlatformSupportSocket (junta-se ao room do thread aberto).
 */
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type {
  SupportMessageDTO,
  SupportThreadPriorityT,
  SupportThreadStatusT,
} from '@hm/shared';
import {
  SUPPORT_THREAD_PRIORITIES,
  SUPPORT_THREAD_STATUSES,
} from '@hm/shared';
import { Button } from '@hm/ui';
import { PriorityBadge, StatusBadge } from './badges';
import { usePatchThread, usePlatformReply, usePlatformThread } from './queries';
import { usePlatformSupportSocket } from './usePlatformSupportSocket';
import { useAuthStore } from '@/shared/stores/auth.store';

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
  'rounded-md border border-border bg-surface-2 px-2 py-1.5 font-body text-xs text-text outline-none focus-visible:border-border-2 focus-visible:shadow-glow-md';

function timeOf(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InboxThread({ threadId }: { threadId: string }) {
  usePlatformSupportSocket(threadId);
  const { data, isLoading, isError, refetch } = usePlatformThread(threadId);
  const reply = usePlatformReply(threadId);
  const patch = usePatchThread(threadId);
  const memberId = useAuthStore((st) => st.auth?.memberId);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const thread = data?.thread;
  const messages: SupportMessageDTO[] = data?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function submit(): void {
    const body = draft.trim();
    if (body === '') return;
    reply.mutate(body, { onSuccess: () => setDraft('') });
  }

  if (isLoading) {
    return <div className="flex-1 p-6 text-sm text-text-low">Carregando conversa...</div>;
  }
  if (isError || !thread) {
    return (
      <div className="flex-1 p-6 text-center">
        <p className="text-sm text-danger">Falha ao carregar a conversa.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border-2 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 truncate font-head text-base font-semibold text-text">
            {thread.subject}
          </h2>
          <StatusBadge status={thread.status} />
          <PriorityBadge priority={thread.priority} />
        </div>
        <p className="font-body text-xs text-text-low">
          Workspace: <span className="font-price text-text-mid">{thread.workspaceId}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-low">
            Status
            <select
              value={thread.status}
              onChange={(e) => patch.mutate({ status: e.target.value as SupportThreadStatusT })}
              className={ctrlCls}
              aria-label="Alterar status"
            >
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
              value={thread.priority}
              onChange={(e) => patch.mutate({ priority: e.target.value as SupportThreadPriorityT })}
              className={ctrlCls}
              aria-label="Alterar prioridade"
            >
              {SUPPORT_THREAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto flex items-center gap-2">
            {thread.assignedTo ? (
              <>
                <span className="font-body text-xs text-text-low">
                  Atribuido:{' '}
                  <span className="font-price text-text-mid">
                    {thread.assignedTo === memberId ? 'Voce' : thread.assignedTo}
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
                <span className="font-body text-xs text-text-low">Nao atribuido</span>
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

      <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite" aria-label="Mensagens">
        <ul className="flex flex-col gap-3">
          {messages.map((m) => {
            const fromPlatform = m.senderType === 'platform';
            return (
              <li
                key={m.id}
                className={fromPlatform ? 'flex flex-col items-end' : 'flex flex-col items-start'}
              >
                <div
                  className={
                    fromPlatform
                      ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-text-on-brand'
                      : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-surface-2 px-3.5 py-2 text-text'
                  }
                >
                  <span className="mb-0.5 block font-head text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {fromPlatform ? 'Equipe Leadium' : 'Cliente'}
                  </span>
                  <span className="whitespace-pre-wrap break-words font-body text-sm">{m.body}</span>
                </div>
                <span className="mt-0.5 font-body text-[11px] text-text-low">{timeOf(m.createdAt)}</span>
              </li>
            );
          })}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="border-t border-border-2 p-3">
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
            placeholder="Responder ao cliente..."
            aria-label="Resposta da equipe"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 font-body text-sm text-text outline-none transition-colors placeholder:text-text-low focus-visible:border-border-2 focus-visible:shadow-glow-md"
          />
          <Button type="submit" variant="primary" size="sm" loading={reply.isPending} disabled={draft.trim() === ''}>
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      </div>
    </div>
  );
}
