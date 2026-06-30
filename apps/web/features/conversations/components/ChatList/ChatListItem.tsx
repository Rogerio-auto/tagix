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
   * `true` quando há OUTRA conversa selecionada e este item não é o ativo —
   * recua visualmente (opacidade + leve queda de luminosidade + véu escuro) para
   * dar profundidade e conduzir o olhar ao chat ativo. Volta ao normal no
   * hover/foco. Nunca aplicado ao item ativo.
   */
  dimmed?: boolean;
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
  { conversation, active, dimmed = false, tabIndex, focused },
  ref,
) {
  const hasUnread = conversation.unreadCount > 0;
  const time = relativeTime(conversation.lastMessageAt);
  const timeFull = fullTimestamp(conversation.lastMessageAt);

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
          // Transição fluida do estado de seleção (glow + fundo + recuo dos
          // demais) — premium e discreta; respeita prefers-reduced-motion.
          'transition-[background-color,background-image,box-shadow,opacity,filter] duration-300 ease-out',
          'motion-reduce:transition-none',
          active
            ? // Estado "ativo/vivo": linha neon animada percorrendo a borda
              // (.hm-chat-neon) + halo ambiente discreto + iluminação sutil
              // vinda do canto superior-esquerdo.
              'hm-chat-neon bg-surface-3 bg-gradient-to-br from-brand/10 via-transparent to-transparent shadow-glow-active'
            : 'hover:bg-surface-2',
          // Hierarquia de foco: quando OUTRA conversa está aberta, os demais
          // itens recuam para o segundo plano. Véu escuro em degradê (::after,
          // sempre presente nos não-ativos para a transição ser fluida nos dois
          // sentidos) + leve queda de opacidade/luminosidade. Hover e foco por
          // teclado restauram 100% — nunca fica "desabilitado", só discreto.
          !active &&
            'after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:bg-gradient-to-t after:from-bg/15 after:to-transparent after:opacity-0 after:transition-opacity after:duration-300',
          !active && dimmed && 'opacity-[0.7] [filter:brightness(0.94)] after:opacity-100',
          !active &&
            'hover:opacity-100 hover:[filter:none] hover:after:opacity-0 focus-visible:opacity-100 focus-visible:[filter:none] focus-visible:after:opacity-0',
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
              {time && (
                <time className="font-body text-xs text-text-low" title={timeFull}>
                  {time}
                </time>
              )}
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
