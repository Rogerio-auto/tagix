'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info, MessageSquare } from 'lucide-react';
import { useSocket } from '@/shared/realtime';
import { EmptyState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { useMessages, useConversationDetail } from '../queries';
import {
  useConversationDetailLive,
  useConversationMessagesLive,
  useMarkConversationRead,
} from '../hooks/useConversationSocket';
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
  // Regra de ouro (MOBILE_UX §3.2): a ESTRUTURA muda por `isMobile`, não por
  // classes Tailwind `md:`. Mobile = pilha de views (Lista→Thread→Cockpit);
  // desktop = 3 colunas. SSR-safe: snapshot mobile primeiro, melhora p/ desktop.
  const { isMobile } = useBreakpoint();
  const [infoOpen, setInfoOpen] = useState(false);

  // Fecha o cockpit ao trocar de conversa (UX §2.3 — não acumula contexto stale).
  useEffect(() => {
    setInfoOpen(false);
  }, [conversationId]);

  if (isMobile) {
    return (
      <MobileConversationsLayout
        conversationId={conversationId}
        infoOpen={infoOpen}
        onOpenInfo={() => setInfoOpen(true)}
        onCloseInfo={() => setInfoOpen(false)}
      />
    );
  }

  // ── Desktop: 3 colunas fixas (inalterado — regressão zero) ──────────────────
  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-border">
      {/* Coluna 1 — lista (F1-S14: filtros/busca/unread/real-time) */}
      <aside
        data-tour-id="inbox-list"
        className="flex w-80 shrink-0 flex-col border-r border-border bg-surface"
      >
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

// ── Mobile: pilha de views guiada pela rota ───────────────────────────────────
//
// A rota é a fonte da verdade da pilha: `/conversations` (sem id) = Lista em tela
// cheia; `/conversations/:id` = Thread em tela cheia. "Voltar" usa router.back()
// (preserva histórico do navegador, scroll e o cache da ChatList no TanStack — a
// lista não perde estado ao voltar). O Cockpit é um `Sheet` full por cima.

function MobileConversationsLayout({
  conversationId,
  infoOpen,
  onOpenInfo,
  onCloseInfo,
}: {
  conversationId?: string;
  infoOpen: boolean;
  onOpenInfo: () => void;
  onCloseInfo: () => void;
}) {
  const router = useRouter();

  // Sem conversa selecionada → Lista em tela cheia (uma intenção por view, §2/§4).
  if (!conversationId) {
    return (
      <div
        data-tour-id="inbox-list"
        className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface"
      >
        <div className="flex items-center justify-between border-b border-border-2 px-4 py-3">
          <span className="font-head text-sm font-semibold text-text">Conversas</span>
          <HelpPanel title="Conversas">
            <ConversationsHelp />
          </HelpPanel>
        </div>
        <ChatList />
      </div>
    );
  }

  // Conversa aberta → Thread em tela cheia + Cockpit como full-sheet.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg">
      <MobileThread
        conversationId={conversationId}
        onBack={() => router.back()}
        onOpenInfo={onOpenInfo}
      />

      {/* Cockpit (ContactInfoPanel) como full-sheet por cima da thread (§2.3). */}
      <Sheet open={infoOpen} onClose={onCloseInfo} title="Cockpit" variant="full">
        <ContactInfoPanel conversationId={conversationId} onClose={onCloseInfo} embedded />
      </Sheet>
    </div>
  );
}

/** Thread mobile: header compacto + bolhas full-width + composer fixo no rodapé. */
function MobileThread({
  conversationId,
  onBack,
  onOpenInfo,
}: {
  conversationId: string;
  onBack: () => void;
  onOpenInfo: () => void;
}) {
  const { data: detailData } = useConversationDetail(conversationId);
  const { joinConversation, leaveConversation } = useSocket();
  const detail = detailData?.conversation;

  // Header/identidade vivos: status/aiMode/assignee/department ao vivo (mesmo
  // socket do desktop — fecha o gap de detail stale quando outro operador muda).
  useConversationDetailLive(conversationId);

  // Entra na room realtime (mesmas queries/socket do desktop — sem alteração).
  useEffect(() => {
    joinConversation(conversationId);
    return () => leaveConversation(conversationId);
  }, [conversationId, joinConversation, leaveConversation]);

  return (
    <>
      {/* Header compacto: voltar + identidade + abrir cockpit (thumb-reach no topo
          só para contexto/voltar; ações frequentes ficam no cockpit/composer). */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para a lista de conversas"
          className="touch-target grid place-items-center rounded-sm text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate font-head text-sm font-semibold text-text">
            {detail?.remoteId ?? 'Conversa'}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenInfo}
          aria-label="Abrir cockpit da conversa"
          className="touch-target grid place-items-center rounded-sm text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
        >
          <Info className="size-5" aria-hidden />
        </button>
      </header>

      <MessageStatusReceipts conversationId={conversationId} />

      <ThreadMessages conversationId={conversationId} className="px-3" />

      <TypingIndicator conversationId={conversationId} className="px-3" />
      <ManualFlowsQuickbar conversationId={conversationId} />

      {/* Composer fixo no rodapé (thumb-first, §1/§4). Fica logo acima da
          BottomNav (que já reserva a safe-area inferior via `pb-safe`), por isso
          aqui NÃO duplicamos o inset — evita gap dobrado em devices com notch. */}
      <MessageComposer conversationId={conversationId} className="shrink-0" />
    </>
  );
}

// ── Lista de bolhas (compartilhada desktop + mobile) ──────────────────────────

function ThreadMessages({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const messages = useMessages(conversationId);
  // Thread ao vivo: invalida as mensagens desta conversa ao chegar `message:new`.
  useConversationMessagesLive(conversationId);
  // Marca como lida ao abrir + a cada nova mensagem enquanto aberta (zera o badge).
  useMarkConversationRead(conversationId);
  const role = useAuthStore((st) => st.auth?.role);
  const canModerateComments = role ? can(role, 'conversation.delete_message') : false;

  return (
    <div className={cn('flex-1 overflow-y-auto overscroll-contain py-4', className)} aria-live="polite">
      {messages.isLoading ? (
        <SkeletonList rows={5} />
      ) : messages.data && messages.data.messages.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {/* A API devolve DESC (mais nova primeiro); a thread exibe cronológico
              (mais antiga no topo, mais nova embaixo) → cópia + reverse. */}
          {[...messages.data.messages].reverse().map((m) => {
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
  const { data: detailData } = useConversationDetail(conversationId);
  const { joinConversation, leaveConversation } = useSocket();

  // Header + Cockpit vivos: invalida o detail/agent/lista quando status/aiMode/
  // assignee/department mudam por outro operador ou pela IA (human_takeover).
  useConversationDetailLive(conversationId);

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

      <ThreadMessages conversationId={conversationId} className="px-4" />

      <TypingIndicator conversationId={conversationId} className="px-4" />
      <ManualFlowsQuickbar conversationId={conversationId} />
      <MessageComposer conversationId={conversationId} />
    </>
  );
}
