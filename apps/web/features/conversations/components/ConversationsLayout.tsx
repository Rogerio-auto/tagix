'use client';

import { useState } from 'react';
import { Info, MessageSquare } from 'lucide-react';
import { EmptyState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { useMessages } from '../queries';
import { ConversationsHelp } from '../help';
import { ChatList } from './ChatList';
import { MessageComposer } from './MessageComposer';
import { ContactInfoPanel } from './ContactInfoPanel';
import { TypingIndicator } from './TypingIndicator';
import { MessageBubble } from './MessageBubble';
import { MessageStatusReceipts } from './MessageBubble/status';

export function ConversationsLayout({ conversationId }: { conversationId?: string }) {
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className="flex h-[calc(100dvh-7rem)] overflow-hidden rounded-lg border border-border">
      {/* Coluna 1 — lista (F1-S14: filtros/busca/unread/real-time) */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border-2 px-4 py-3">
          <span className="font-head text-sm font-semibold text-text">Conversas</span>
          <HelpPanel title="Conversas">
            <ConversationsHelp />
          </HelpPanel>
        </div>
        <ChatList activeConversationId={conversationId} />
      </aside>

      {/* Coluna 2 — painel da conversa (bolhas ricas em F1-S15) */}
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

      {/* Recibos em tempo real (F1-S20): patcha o viewStatus no cache ao chegar status_changed. */}
      <MessageStatusReceipts conversationId={conversationId} />

      <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
        {messages.isLoading ? (
          <SkeletonList rows={5} />
        ) : messages.data && messages.data.messages.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {messages.data.messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center font-body text-sm text-text-low">Nenhuma mensagem ainda.</p>
        )}
      </div>

      <TypingIndicator conversationId={conversationId} className="px-4" />
      <MessageComposer conversationId={conversationId} />
    </>
  );
}
