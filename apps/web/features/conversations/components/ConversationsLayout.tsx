'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Info, MessageSquare } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { cn } from '@/shared/lib/cn';
import { useConversations, useMessages } from '../queries';
import { ConversationsHelp } from '../help';
import { ContactInfoPanel } from './ContactInfoPanel';

export function ConversationsLayout({ conversationId }: { conversationId?: string }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const conversations = useConversations();

  return (
    <div className="flex h-[calc(100dvh-7rem)] overflow-hidden rounded-lg border border-border">
      {/* Coluna 1 — lista (enriquecida em F1-S14: filtros/busca/real-time) */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border-2 px-4 py-3">
          <span className="font-head text-sm font-semibold text-text">Conversas</span>
          <HelpPanel title="Conversas">
            <ConversationsHelp />
          </HelpPanel>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.isLoading ? (
            <div className="p-3">
              <SkeletonList rows={6} />
            </div>
          ) : conversations.data && conversations.data.conversations.length > 0 ? (
            <ul>
              {conversations.data.conversations.map((conv) => {
                const active = conv.id === conversationId;
                return (
                  <li key={conv.id}>
                    <Link
                      href={`/conversations/${conv.id}`}
                      className={cn(
                        'flex items-center gap-3 border-l-2 px-4 py-3 outline-none transition-colors',
                        active
                          ? 'border-brand bg-surface-3'
                          : 'border-transparent hover:bg-surface-2 focus-visible:bg-surface-2',
                      )}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-3 font-head text-sm text-text-mid">
                        {(conv.remoteId || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-head text-sm text-text">{conv.remoteId}</p>
                        <p className="truncate font-body text-sm text-text-low">
                          {conv.lastMessagePreview ?? 'Sem mensagens'}
                        </p>
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="rounded-pill bg-brand px-1.5 text-xs font-semibold text-text-on-brand">
                          {conv.unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma conversa"
              description="Conecte um canal para começar a receber mensagens."
              action={
                <Button variant="primary" onClick={() => undefined}>
                  Conectar canal
                </Button>
              }
            />
          )}
        </div>
      </aside>

      {/* Coluna 2 — painel da conversa (bolhas em F1-S15, composer em F1-S16) */}
      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        {conversationId ? (
          <ConversationPanel
            conversationId={conversationId}
            onToggleInfo={() => setInfoOpen((v) => !v)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="Selecione uma conversa"
              description="Escolha uma conversa na lista para começar a atender."
            />
          </div>
        )}
      </section>

      {/* Coluna 3 — info do contato (toggle) */}
      {infoOpen && conversationId && (
        <ContactInfoPanel conversationId={conversationId} onClose={() => setInfoOpen(false)} />
      )}
    </div>
  );
}

function ConversationPanel({
  conversationId,
  onToggleInfo,
}: {
  conversationId: string;
  onToggleInfo: () => void;
}) {
  const messages = useMessages(conversationId);

  return (
    <>
      <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
        <span className="font-head font-semibold text-text">Conversa</span>
        <button
          type="button"
          onClick={onToggleInfo}
          aria-label="Informações do contato"
          className="rounded-sm p-2 text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
        >
          <Info className="size-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
        {messages.isLoading ? (
          <SkeletonList rows={5} />
        ) : messages.data && messages.data.messages.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {/* Renderização rica (MessageBubble) entra em F1-S15. */}
            {messages.data.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'max-w-[70%] rounded-md px-3 py-2 font-body text-sm',
                  m.direction === 'outbound'
                    ? 'self-end bg-surface-3 text-text'
                    : 'self-start bg-surface-2 text-text',
                )}
              >
                {m.content ?? `[${m.type}]`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center font-body text-sm text-text-low">Nenhuma mensagem ainda.</p>
        )}
      </div>

      {/* Composer real entra em F1-S16. */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-sm text-text-low">
          Composer disponível em breve…
        </div>
      </div>
    </>
  );
}
