'use client';

/**
 * Ponto de entrada "Falar com o suporte" na Central de Ajuda (F38-S05).
 * O chat ao vivo do membro com a equipe Leadium e entregue no F38-S09 (UI de
 * chat real-time) sob /help/support. Aqui fica o launcher previsto: link para a
 * rota de suporte. S09 monta a experiencia completa sem mexer neste card.
 */
import Link from 'next/link';
import { ArrowRight, Headset } from 'lucide-react';

export function SupportLauncher() {
  return (
    <Link
      href="/help/support"
      className="group flex items-center gap-4 rounded-lg border border-border bg-surface-2 px-5 py-4 outline-none transition-colors hover:border-border-2 hover:bg-surface-3 focus-visible:shadow-glow-md"
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
    </Link>
  );
}
