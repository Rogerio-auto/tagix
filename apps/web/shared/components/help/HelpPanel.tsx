'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Sheet } from './Sheet';

export interface HelpPanelProps {
  title: string;
  children: ReactNode;
}

/**
 * Botão `?` que abre um HelpPanel lateral persistente (UX §2.5 — explicação de
 * feature vai aqui, NUNCA em tooltip). Dropar no `helpSlot` do PageHeader.
 * O conteúdo de cada feature mora em `features/<f>/help.tsx`.
 */
export function HelpPanel({ title, children }: HelpPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ajuda: ${title}`}
        className="grid size-8 place-items-center rounded-sm text-text-low outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
      >
        <HelpCircle className="size-[1.125rem]" aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {children}
      </Sheet>
    </>
  );
}
