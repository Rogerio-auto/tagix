'use client';

import type { ReactNode } from 'react';
import { AccountBanner } from './AccountBanner';
import { SubscriptionInactiveBridge } from './SubscriptionInactiveBridge';

/**
 * Moldura do shell: empilha as faixas (banners) acima do app SEM estourar a altura.
 * O `AppLayout` é um shell de altura fixa (`h-dvh`) com scroll só interno; uma faixa
 * acima dele somaria altura e cortaria o rodapé. A moldura vira a coluna `h-dvh` e o
 * filho `.h-dvh` do `AppLayout` passa a ocupar o espaço que sobra (`flex-1`).
 *
 * Safe-area (notch): a primeira faixa (`[data-banner]`) é a dona do `pt-safe`; faixas
 * seguintes e a `TopBar` (`[data-topbar]`) zeram o delas. Sem faixa, a `TopBar` aplica.
 * Absorve a ressalva do F71-S16 (recuo duplicado sob a faixa de conta).
 */
export function AppShellFrame({
  banners,
  children,
}: {
  /** Faixas externas já existentes (ex.: view-as), empilhadas antes da de conta. */
  banners?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        'flex h-dvh flex-col overflow-hidden [&>.h-dvh]:h-auto [&>.h-dvh]:min-h-0 [&>.h-dvh]:flex-1',
        '[&>[data-banner]~[data-banner]]:pt-0 [&:has(>[data-banner])_[data-topbar]]:pt-0',
      ].join(' ')}
    >
      {banners}
      <AccountBanner />
      <SubscriptionInactiveBridge />
      {children}
    </div>
  );
}
