'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useSocket } from '@/shared/realtime';
import type { ContactPresence, TypingFromContactPayload } from '@hm/shared';

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
 * Assina `typing:from_contact` no socket REATIVO (`useSocket`) e filtra pela
 * conversa atual. Cada sinal rearma um timer de `PRESENCE_TTL_MS`; quando ele
 * expira (o contato parou), o indicador some. Sem socket conectado, nunca aparece.
 *
 * Migrado de `window.__hmSocket` para o socket de contexto: ler o global na
 * montagem corria com o `SocketProvider` (efeito filho-antes-do-pai) e o listener
 * nunca era anexado → "digitando…" não aparecia ao vivo. Com `socket` no dep do
 * efeito, anexa assim que a conexão existe (mesma correção de S14).
 *
 * Acessibilidade: `aria-live="polite"` com texto somente-leitor para que o
 * estado seja anunciado a leitores de tela. A animação dos três pontos é
 * puramente decorativa (`aria-hidden`) e gated por `motion-safe:` — respeita
 * `prefers-reduced-motion` (sem movimento, os pontos ficam estáticos).
 */
export function TypingIndicator({ conversationId, className }: TypingIndicatorProps) {
  const [presence, setPresence] = useState<ContactPresence | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { socket } = useSocket();

  useEffect(() => {
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
  }, [conversationId, socket]);

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
