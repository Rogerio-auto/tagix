'use client';

import { Instagram, MessageCircle, Sparkles } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/**
 * Badge de tipo de conversa IG na ChatList (F15-S08, INSTAGRAM.md 12.2/12.3).
 * Distingue comment_thread (comentarios) e story_thread (stories) das DMs.
 * Conversas direct (WA ou IG DM) nao recebem badge aqui — o icone de provider
 * fica a cargo do avatar. Tokens semanticos, zero hex.
 */
export function ConversationKindBadge({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'comment_thread') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-pill bg-surface px-1.5 py-0.5 text-[0.625rem] font-medium text-text-mid',
          className,
        )}
        title="Comentarios"
      >
        <MessageCircle className="size-3" aria-hidden />
        Coment.
      </span>
    );
  }
  if (kind === 'story_thread') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-pill bg-surface px-1.5 py-0.5 text-[0.625rem] font-medium text-text-mid',
          className,
        )}
        title="Story"
      >
        <Sparkles className="size-3" aria-hidden />
        Story
      </span>
    );
  }
  return null;
}

/**
 * Icone de canal Instagram com gradiente sutil, sobreposto ao avatar na
 * ChatList. Renderizado quando a conversa e de um canal IG.
 */
export function InstagramChannelMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-4 items-center justify-center rounded-pill bg-surface-3 text-brand',
        className,
      )}
      aria-label="Instagram"
    >
      <Instagram className="size-3" aria-hidden />
    </span>
  );
}
