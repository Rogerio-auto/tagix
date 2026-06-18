'use client';

/**
 * Ponto de entrada "Falar com o suporte" na Central de Ajuda (F38-S05/S09).
 * Abre o chat ao vivo do membro com a equipe Leadium (overlay, sem mudar de
 * rota) — canal interno via Socket.io, nao passa por Meta/WhatsApp.
 */
import { useState } from 'react';
import { ArrowRight, Headset } from 'lucide-react';
import { SupportChat } from '@/features/support';

export function SupportLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-4 rounded-lg border border-border bg-surface-2 px-5 py-4 text-left outline-none transition-colors hover:border-border-2 hover:bg-surface-3 focus-visible:shadow-glow-md"
      >
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
          <Headset className="size-5" aria-hidden />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="font-head text-sm font-semibold text-text">Falar com o suporte</span>
          <span className="font-body text-sm text-text-mid">
            Nao achou o que precisava? Fale direto com a equipe Leadium.
          </span>
        </span>
        <ArrowRight
          className="size-5 shrink-0 text-text-low transition-transform group-hover:translate-x-0.5 group-hover:text-text"
          aria-hidden
        />
      </button>
      <SupportChat open={open} onClose={() => setOpen(false)} />
    </>
  );
}
