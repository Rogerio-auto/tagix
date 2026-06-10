'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import type { ContactPresence, TypingFromContactPayload } from '@hm/shared';

/**
 * Assinatura mínima do cliente Socket.io (Server→Client) que o indicador de
 * presença precisa. Tipada contra o mapa de eventos de `@hm/shared` — sem
 * acoplar a `socket.io-client` (ainda não é dependência de @hm/web).
 *
 * O orquestrador injeta a instância real em `window.__hmSocket` quando o
 * provider de real-time for montado. Enquanto não existir, o indicador degrada
 * para no-op (nunca aparece) — sem quebrar typecheck/build. Mesmo padrão de
 * `hooks/useConversationSocket.ts` (S14).
 */
export interface TypingSocket {
  on(event: 'typing:from_contact', listener: (p: TypingFromContactPayload) => void): unknown;
  off(event: 'typing:from_contact', listener: (p: TypingFromContactPayload) => void): unknown;
}

/**
 * O global `window.__hmSocket` é declarado em `hooks/useConversationSocket.ts`
 * com uma fatia (`ConversationSocket`) do mesmo cliente Socket.io injetado. Não
 * redeclaramos o global (colidiria); resolvemos a instância e a estreitamos
 * para `TypingSocket` via `unknown` — em runtime é o mesmo socket.io client,
 * que suporta todos os eventos do mapa Server→Client de `@hm/shared`.
 */
function resolveSocket(): TypingSocket | undefined {
  if (typeof window === 'undefined') return undefined;
  const shared = window.__hmSocket;
  if (shared === undefined) return undefined;
  return shared as unknown as TypingSocket;
}

/**
 * Janela de "vida" de um sinal de presença. O provider emite `typing` de forma
 * intermitente enquanto o contato digita; sem um `stop` explícito no contrato,
 * cada sinal mantém o indicador vivo por este intervalo e então some sozinho.
 */
const PRESENCE_TTL_MS = 4_000;

/** Rótulo acessível/legível por presença (pt-BR). */
const PRESENCE_LABEL: Record<ContactPresence, string> = {
  typing: 'digitando…',
  recording: 'gravando áudio…',
};

export interface TypingIndicatorProps {
  /** Conversa observada — só reage a eventos desta conversa. */
  conversationId: string;
  className?: string;
}

/**
 * Indicador "digitando…/gravando…" do contato (LIVECHAT.md §6).
 *
 * Assina `typing:from_contact` no socket compartilhado e filtra pela conversa
 * atual. Cada sinal rearma um timer de `PRESENCE_TTL_MS`; quando ele expira (o
 * contato parou), o indicador some. Sem socket injetado, nunca aparece.
 *
 * Acessibilidade: `aria-live="polite"` com texto somente-leitor para que o
 * estado seja anunciado a leitores de tela. A animação dos três pontos é
 * puramente decorativa (`aria-hidden`) e gated por `motion-safe:` — respeita
 * `prefers-reduced-motion` (sem movimento, os pontos ficam estáticos).
 */
export function TypingIndicator({ conversationId, className }: TypingIndicatorProps) {
  const [presence, setPresence] = useState<ContactPresence | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = resolveSocket();
    if (!socket) return;

    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onTyping = (p: TypingFromContactPayload): void => {
      if (p.conversationId !== conversationId) return;
      setPresence(p.presence);
      clearTimer();
      timerRef.current = setTimeout(() => {
        setPresence(null);
        timerRef.current = null;
      }, PRESENCE_TTL_MS);
    };

    socket.on('typing:from_contact', onTyping);

    return () => {
      socket.off('typing:from_contact', onTyping);
      clearTimer();
      setPresence(null);
    };
  }, [conversationId]);

  if (presence === null) return null;

  const label = PRESENCE_LABEL[presence];

  return (
    <div
      aria-live="polite"
      className={cn('flex items-center gap-2', className)}
      data-presence={presence}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-2xl bg-surface-2 px-3 py-2',
          'motion-safe:animate-[hm-fade-in_180ms_ease-out]',
        )}
      >
        <Dot delayClass="" />
        <Dot delayClass="[animation-delay:150ms]" />
        <Dot delayClass="[animation-delay:300ms]" />
        <span className="sr-only">{label}</span>
      </span>
    </div>
  );
}

/** Um dos três pontos animados. Decorativo: `aria-hidden`, `motion-safe:`. */
function Dot({ delayClass }: { delayClass: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 rounded-pill bg-text-low',
        'motion-safe:animate-bounce',
        delayClass,
      )}
    />
  );
}
