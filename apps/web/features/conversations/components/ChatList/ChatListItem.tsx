'use client';

/**
 * Item da ChatList — conversa na sidebar (F1-S14 / F30-S03).
 *
 * F30-S03: badge de IA (on/paused) visível no item.
 *  - `aiMode='on'`    → ponto verde com ícone Bot (IA ativa).
 *  - `aiMode='paused'`→ ponto amarelo com ícone Bot (atendente assumiu).
 *
 * UX §2.10: roving tabindex; §3.5: focus ring nunca suprimido.
 * DS v2: zero hex hardcoded, tokens semânticos.
 */

import { forwardRef } from 'react';
import Link from 'next/link';
import { Bot } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { FlowExecutionsBadge } from '@/features/flow-builder/livechat';
import { ConversationKindBadge } from '../IgComments/ConversationKindBadge';
import { MessagePreview } from './MessagePreview';
import type { ConversationSummary } from '../../types';

export interface ChatListItemProps {
  conversation: ConversationSummary;
  active: boolean;
  /**
   * Roving tabindex (UX §2.10 / WAI-ARIA list pattern): apenas o item com foco
   * lógico participa da tab order; os demais recebem `-1` e são alcançados pelas
   * setas ↑/↓.
   */
  tabIndex: number;
  /** Marca o item focado logicamente quando navegado por teclado. */
  focused: boolean;
}

function initials(remoteId: string): string {
  return (remoteId || '?').slice(0, 2).toUpperCase();
}

/** Hora curta (HH:MM) da última atividade, ou vazio. */
function shortTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Badge de estado da IA — on (verde) ou paused (âmbar). */
function AiBadge({ aiMode }: { aiMode: string }) {
  if (aiMode !== 'on' && aiMode !== 'paused') return null;

  const isPaused = aiMode === 'paused';
  return (
    <span
      aria-label={isPaused ? 'IA pausada — atendente assumiu' : 'IA ativa'}
      title={isPaused ? 'IA pausada — atendente assumiu' : 'IA ativa'}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5',
        'font-body text-[10px] font-medium leading-none',
        isPaused
          ? 'bg-warning/15 text-warning'
          : 'bg-success/15 text-success',
      )}
    >
      <Bot className="size-2.5" aria-hidden />
      {isPaused ? 'Pausada' : 'IA'}
    </span>
  );
}

export const ChatListItem = forwardRef<HTMLAnchorElement, ChatListItemProps>(function ChatListItem(
  { conversation, active, tabIndex, focused },
  ref,
) {
  const hasUnread = conversation.unreadCount > 0;
  const time = shortTime(conversation.lastMessageAt);

  return (
    <li role="option" aria-selected={active}>
      <Link
        ref={ref}
        href={`/conversations/${conversation.id}`}
        aria-current={active ? 'true' : undefined}
        tabIndex={tabIndex}
        data-conversation-id={conversation.id}
        className={cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-3 outline-none',
          // Transição fluida do estado de seleção (glow + fundo) — premium e
          // discreta; respeita prefers-reduced-motion.
          'transition-[background-color,background-image,box-shadow] duration-300 ease-out',
          'motion-reduce:transition-none',
          active
            ? // Estado "ativo/vivo": linha neon animada percorrendo a borda
              // (.hm-chat-neon) + halo ambiente discreto + iluminação sutil
              // vinda do canto superior-esquerdo.
              'hm-chat-neon bg-surface-3 bg-gradient-to-br from-brand/10 via-transparent to-transparent shadow-glow-active'
            : 'hover:bg-surface-2',
          // Foco real (focus-visible) e foco lógico do roving tabindex pintam o
          // mesmo anel — §3.5 (focus nunca suprimido).
          'focus-visible:bg-surface-2 focus-visible:shadow-glow-md',
          focused && !active && 'bg-surface-2',
        )}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-3 font-head text-sm text-text-mid">
          {initials(conversation.remoteId)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cn(
                'truncate font-head text-sm',
                hasUnread ? 'font-semibold text-text' : 'text-text',
              )}
            >
              {conversation.remoteId}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <ConversationKindBadge kind={conversation.kind} />
              {time && <time className="font-body text-xs text-text-low">{time}</time>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <MessagePreview preview={conversation.lastMessagePreview} unread={hasUnread} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* F30-S03: badge de IA (on/paused) */}
              <AiBadge aiMode={conversation.aiMode} />
              <FlowExecutionsBadge conversationId={conversation.id} interactive={false} />
            </div>
          </div>
        </div>

        {hasUnread && (
          <span
            className="ml-1 inline-flex min-w-5 shrink-0 items-center justify-center rounded-pill bg-brand px-1.5 py-0.5 font-head text-xs font-semibold text-text-on-brand"
            aria-label={`${conversation.unreadCount} não lidas`}
          >
            {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
          </span>
        )}
      </Link>
    </li>
  );
});
