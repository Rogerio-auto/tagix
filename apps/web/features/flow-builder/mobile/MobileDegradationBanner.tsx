'use client';

import { Info } from 'lucide-react';

/**
 * Banner de degradação honesta (UX §2.11, MOBILE_UX §2 — canvas degrada honestamente
 * abaixo de tablet). No celular o Flow Builder é inspecionar/operar (read-first): pan/zoom,
 * inspecionar nodes e operar o ciclo de vida. A edição estrutural do grafo (arrastar nodes,
 * conectar/desconectar) fica melhor no desktop/tablet.
 */
export function MobileDegradationBanner(): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 border-b border-border-2 bg-surface-1 px-4 py-2.5">
      <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <p className="text-xs leading-snug text-text-low">
        No celular você inspeciona e opera o flow. A{' '}
        <span className="text-text">edição estrutural do grafo é melhor no desktop ou tablet</span>.
      </p>
    </div>
  );
}
