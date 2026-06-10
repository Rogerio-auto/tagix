'use client';

import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import { FlowExecutionsBadge } from '@/features/flow-builder/livechat';
import type { ConversationSummary } from '../../types';

export interface ChatListItemProps {
  conversation: ConversationSummary;
  active: boolean;
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

export function ChatListItem({ conversation, active }: ChatListItemProps) {
  const hasUnread = conversation.unreadCount > 0;
  const time = shortTime(conversation.lastMessageAt);

  return (
    <li>
      <Link
        href={`/conversations/${conversation.id}`}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex items-center gap-3 border-l-2 px-4 py-3 outline-none transition-colors',
          active
            ? 'border-brand bg-surface-3'
            : 'border-transparent hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md',
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
            {time && <time className="shrink-0 font-body text-xs text-text-low">{time}</time>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                'truncate font-body text-sm',
                hasUnread ? 'text-text-mid' : 'text-text-low',
              )}
            >
              {conversation.lastMessagePreview ?? 'Sem mensagens'}
            </p>
            <FlowExecutionsBadge conversationId={conversation.id} interactive={false} />
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
}
