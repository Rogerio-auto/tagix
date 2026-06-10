'use client';

import { X } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';

/**
 * Painel lateral de informações do contato (UX §2.3 — painel, não modal).
 * Esqueleto no MVP; dados reais (tags, deals, notas, timeline) vêm com a API de
 * contatos e os slots de notas/routing (F1-S22/S23).
 */
export function ContactInfoPanel({
  conversationId: _conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-14 items-center justify-between border-b border-border-2 px-4">
        <span className="font-head text-sm font-semibold text-text">Contato</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar painel"
          className="rounded-sm p-1.5 text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="size-16 rounded-pill" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <p className="font-body text-xs text-text-low">
          Tags, deals, eventos e notas aparecem aqui (F1-S22/S23).
        </p>
      </div>
    </aside>
  );
}
