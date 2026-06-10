'use client';

import { X } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import { NotesPanel } from './Notes';

/**
 * Painel lateral de informações do contato (UX §2.3 — painel, não modal).
 * Cabeçalho do contato ainda é esqueleto (dados reais vêm com a API de contatos);
 * Notas internas (F1-S22) já são funcionais. Tags/deals/timeline: slots futuros.
 */
export function ContactInfoPanel({
  conversationId,
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
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Cabeçalho do contato — dados reais entram com a API de contatos. */}
        <div className="space-y-4 border-b border-border-2 p-4">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="size-16 rounded-pill" />
            <Skeleton className="h-4 w-32" />
          </div>
          <p className="text-center font-body text-xs text-text-low">
            Tags, deals e timeline aparecem aqui em breve.
          </p>
        </div>
        {/* Notas internas + @menções (F1-S22). `members` virá de uma query de membros. */}
        <NotesPanel conversationId={conversationId} />
      </div>
    </aside>
  );
}
