'use client';

/**
 * Ponto de entrada "Falar com o suporte" na Central de Ajuda (F38-S05/S09; DS 3.0 na
 * F72-S08). Abre o chat ao vivo do membro com a equipe Leadium (overlay, sem mudar de
 * rota) — canal interno via Socket.io, não passa por Meta/WhatsApp.
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
        aria-haspopup="dialog"
        className="group flex w-full items-center gap-4 rounded-lg border border-border bg-surface-2 px-5 py-5 text-left outline-none transition-[border-color,background-color] duration-(--dur-base) ease-ds hover:border-border-2 hover:bg-surface-3 focus-visible:focus-ring"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-md border border-border-brand bg-brand-text/10 text-brand-text">
          <Headset className="size-5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-body font-bold text-text">Falar com o suporte</span>
          <span className="font-body text-sm text-text-mid">
            Não achou o que precisava? Fale direto com a equipe Leadium.
          </span>
        </span>
        <ArrowRight
          className="size-5 shrink-0 text-text-low transition-[transform,color] duration-(--dur-base) ease-ds group-hover:text-text motion-safe:group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
      <SupportChat open={open} onClose={() => setOpen(false)} />
    </>
  );
}
