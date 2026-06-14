'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useSocket } from '@/shared/realtime';
import { EmptyState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { useMessages, useConversationDetail } from '../queries';
import { ConversationsHelp } from '../help';
import { ChatList } from './ChatList';
import { MessageComposer } from './MessageComposer';
import { ManualFlowsQuickbar } from '@/features/flow-builder/livechat';
import { ContactInfoPanel } from './ContactInfoPanel';
import { ConversationHeader } from './ConversationHeader';
import { TypingIndicator } from './TypingIndicator';
import { MessageBubble } from './MessageBubble';
import { MessageStatusReceipts } from './MessageBubble/status';
import { IgCommentActions, type IgComment } from './IgComments';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';


/** Constroi um IgComment a partir do metadata de uma mensagem type='comment'. */
function igCommentFromMessage(m: {
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
  content: string | null;
  createdAt: string;
}): { comment: IgComment; mediaId: string } | null {
  const meta = m.metadata ?? {};
  const commentId =
    typeof meta['commentId'] === 'string' ? (meta['commentId'] as string) : (m.externalId ?? null);
  const mediaId = typeof meta['mediaId'] === 'string' ? (meta['mediaId'] as string) : null;
  if (commentId === null || mediaId === null) return null;
  const parentCommentId =
    typeof meta['parentCommentId'] === 'string' ? (meta['parentCommentId'] as string) : null;
  const fromUsername =
    typeof meta['fromUsername'] === 'string' ? (meta['fromUsername'] as string) : null;
  return {
    mediaId,
    comment: {
      id: commentId,
      mediaId,
      commentId,
      parentCommentId,
      fromIgsid: null,
      fromUsername,
      text: m.content,
      mediaKind: null,
      hidden: false,
      createdAt: m.createdAt,
    },
  };
}

export function ConversationsLayout({ conversationId }: { conversationId?: string }) {
  const [infoOpen, setInfoOpen] = useState(false);

  // Fecha o painel ao trocar de conversa (UX §2.3 — não acumula contexto stale).
  useEffect(() => {
    setInfoOpen(false);
  }, [conversationId]);

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
            infoOpen={infoOpen}
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

      {/* Coluna 3 — cockpit (toggle) */}
      {infoOpen && conversationId && (
        <ContactInfoPanel conversationId={conversationId} onClose={() => setInfoOpen(false)} />
      )}
    </div>
  );
}

function ConversationPanel({
  conversationId,
  infoOpen,
  onToggleInfo,
}: {
  conversationId: string;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  const messages = useMessages(conversationId);
  const { data: detailData } = useConversationDetail(conversationId);
  const { joinConversation, leaveConversation } = useSocket();
  const role = useAuthStore((st) => st.auth?.role);
  const canModerateComments = role ? can(role, 'conversation.delete_message') : false;

  // Entra na room realtime da conversa aberta (recebe message:new, typing, status…).
  useEffect(() => {
    joinConversation(conversationId);
    return () => leaveConversation(conversationId);
  }, [conversationId, joinConversation, leaveConversation]);

  return (
    <>
      {/* Header espelho condicional (F30-S03) — ações somem quando painel aberto */}
      <ConversationHeader
        conversationId={conversationId}
        detail={detailData?.conversation}
        panelOpen={infoOpen}
        onTogglePanel={onToggleInfo}
      />

      {/* Recibos em tempo real (F1-S20): patcha o viewStatus no cache ao chegar status_changed. */}
      <MessageStatusReceipts conversationId={conversationId} />

      <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
        {messages.isLoading ? (
          <SkeletonList rows={5} />
        ) : messages.data && messages.data.messages.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {messages.data.messages.map((m) => {
              const ig =
                m.type === 'comment' || m.type === 'comment_reply'
                  ? igCommentFromMessage(m)
                  : null;
              return (
                <li key={m.id} className="flex flex-col gap-1.5">
                  <MessageBubble message={m} />
                  {ig && (
                    <IgCommentActions
                      comment={ig.comment}
                      mediaId={ig.mediaId}
                      canModerate={canModerateComments}
                      className="pl-1"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-8 text-center font-body text-sm text-text-low">
            Nenhuma mensagem ainda.
          </p>
        )}
      </div>

      <TypingIndicator conversationId={conversationId} className="px-4" />
      <ManualFlowsQuickbar conversationId={conversationId} />
      <MessageComposer conversationId={conversationId} />
    </>
  );
}
