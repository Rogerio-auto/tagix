'use client';

/**
 * Item da ChatList — conversa na sidebar (F1-S14 / F30-S03).
 *
 * F72-S05 (DS 3.0 "Inbox"): linha densa, avatar sem número (ícone de pessoa) com cor
 * determinística, selo de canal sobre o avatar, não lido em mono, seleção ativa
 * silenciosa (superfície + barra de 2px; sem o neon animado — movimento contínuo só
 * em estado vivo). Telefone como 2ª linha quando há homônimos (`showPhone`).
 *
 * A11y: o item é um `<a>` dentro de `<li>` de uma `<ul>` em `<nav>` (sem `role=option`
 * com link aninhado: `nested-interactive`). UX §2.10: roving tabindex; §3.5: focus
 * ring nunca suprimido.
 */

import { forwardRef } from 'react';
import Link from 'next/link';
import { Bot, Instagram, MessageCircle } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { FlowExecutionsBadge } from '@/features/flow-builder/livechat';
import { ConversationKindBadge } from '../IgComments/ConversationKindBadge';
import { MessagePreview } from './MessagePreview';
import { ContactAvatar } from '../ContactAvatar';
import { avatarKeyOf, channelOf, contactLabel, type ChannelFamily } from '../../contact-label';
import type { ConversationSummary } from '../../types';

export interface ChatListItemProps {
  conversation: ConversationSummary;
  active: boolean;
  /**
   * Mostra o telefone como segunda linha. A lista liga quando há outro contato com o
   * mesmo nome visível (homônimos): o número é o que os diferencia.
   */
  showPhone?: boolean;
  /**
   * Roving tabindex (UX §2.10 / WAI-ARIA): apenas o item com foco lógico participa da
   * tab order; os demais recebem `-1` e são alcançados pelas setas ↑/↓.
   */
  tabIndex: number;
  /** Marca o item focado logicamente quando navegado por teclado. */
  focused: boolean;
}

/**
 * Carimbo da última atividade, estilo WhatsApp: HOJE → hora (HH:MM); ONTEM →
 * "ontem"; últimos 7 dias → dia da semana (seg/ter…); mais antigo → DD/MM.
 * Sem o dia, hoje 11:43 parecia "fora de ordem" acima de ontem 15:19 (a
 * ordenação por last_message_at está correta — era só o display de hora-pura).
 */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfThatDay) / 86_400_000);

  if (diffDays <= 0) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Data + hora completas (tooltip do carimbo). */
function fullTimestamp(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Selo de canal sobre o avatar (WhatsApp / Instagram). Ícone com nome acessível. */
function ChannelMark({ channel, active }: { channel: ChannelFamily | null; active: boolean }) {
  if (channel === null) return null;
  const isIg = channel === 'instagram';
  return (
    <span
      role="img"
      aria-label={isIg ? 'Instagram' : 'WhatsApp'}
      className={cn(
        'absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-pill',
        // O anel acompanha o fundo da linha (ativo / hover), senão vira um halo.
        'border-2 bg-surface-3 transition-colors duration-150 motion-reduce:transition-none',
        active ? 'border-surface-2' : 'border-surface group-hover:border-surface-2',
        isIg ? 'text-violet' : 'text-success',
      )}
    >
      {isIg ? (
        <Instagram className="size-2.5" aria-hidden />
      ) : (
        <MessageCircle className="size-2.5" aria-hidden />
      )}
    </span>
  );
}

/** Selo de IA: ativa (sucesso) ou pausada (atendente assumiu). Tons de status ≥4,5:1 nos dois temas. */
function AiBadge({ aiMode }: { aiMode: string }) {
  if (aiMode !== 'on' && aiMode !== 'paused') return null;

  const isPaused = aiMode === 'paused';
  const label = isPaused ? 'IA pausada — atendente assumiu' : 'IA ativa';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5',
        'font-body text-xs leading-none font-bold',
        isPaused ? 'bg-warn-bg text-warn' : 'bg-success-bg text-success',
      )}
    >
      <Bot className="size-3" aria-hidden />
      {isPaused ? 'Pausada' : 'IA'}
    </span>
  );
}

export const ChatListItem = forwardRef<HTMLAnchorElement, ChatListItemProps>(function ChatListItem(
  { conversation, active, showPhone = false, tabIndex, focused },
  ref,
) {
  const hasUnread = conversation.unreadCount > 0;
  const time = relativeTime(conversation.lastMessageAt);
  const timeFull = fullTimestamp(conversation.lastMessageAt);
  const channel = channelOf(conversation);
  const who = contactLabel({
    displayName: conversation.contactDisplayName,
    profileName: conversation.contactProfileName,
    remoteId: conversation.remoteId,
    channel: channel ?? conversation.kind,
  });
  // Com nome, o telefone vai pra 2ª linha só entre homônimos; sem nome o título já é o telefone.
  const phoneLine = showPhone && who.source !== 'phone' ? who.secondary : null;
  // Threads de comentário/story já dizem "Instagram" pelo selo de tipo: sem selo duplicado.
  const kindShowsChannel = conversation.kind === 'comment_thread' || conversation.kind === 'story_thread';

  return (
    <li>
      <Link
        ref={ref}
        href={`/conversations/${conversation.id}`}
        aria-current={active ? 'page' : undefined}
        tabIndex={tabIndex}
        data-conversation-id={conversation.id}
        data-active={active ? 'true' : undefined}
        data-unread={hasUnread ? 'true' : undefined}
        data-roving={focused ? 'true' : undefined}
        title={who.secondary ?? undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 outline-none',
          'transition-colors duration-150 motion-reduce:transition-none',
          active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
          // Seleção ativa: barra de 2px em brand-text — o estado não depende só do fundo.
          active &&
            "before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-pill before:bg-brand-text before:content-['']",
          'focus-visible:focus-ring',
        )}
      >
        <span className="relative shrink-0">
          <ContactAvatar who={who} colorKey={avatarKeyOf(conversation)} size="sm" />
          <ChannelMark channel={kindShowsChannel ? null : channel} active={active} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cn(
                'truncate font-head text-sm text-text',
                hasUnread ? 'font-semibold' : 'font-medium',
              )}
            >
              {who.label}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <ConversationKindBadge kind={conversation.kind} />
              {time && (
                <time
                  className={cn(
                    'font-mono text-xs tabular-nums',
                    hasUnread ? 'text-text-mid' : 'text-text-low',
                  )}
                  title={timeFull}
                >
                  {time}
                </time>
              )}
            </div>
          </div>
          {phoneLine && (
            <p className="truncate font-mono text-xs tabular-nums text-text-low">{phoneLine}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <MessagePreview preview={conversation.lastMessagePreview} unread={hasUnread} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <AiBadge aiMode={conversation.aiMode} />
              <FlowExecutionsBadge conversationId={conversation.id} interactive={false} />
              {hasUnread && (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-pill bg-brand-text/15 px-1.5 py-0.5 font-mono text-xs leading-none font-semibold tabular-nums text-brand-text"
                  aria-label={`${conversation.unreadCount} não lidas`}
                >
                  {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
});
