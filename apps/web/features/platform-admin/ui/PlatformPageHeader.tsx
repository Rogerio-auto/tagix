'use client';

import type { ReactNode } from 'react';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { platformNavItem } from '../shell/nav-items';

/**
 * Cabeçalho de toda tela do painel: o `PageHeader` do app (um `<h1>`, ritmo editorial)
 * com o `?` da área (UX §2.5). O texto base do `?` vem de `PLATFORM_NAV`; a tela pode
 * acrescentar parágrafos (`help`).
 */
export function PlatformPageHeader({
  href,
  title,
  description,
  actions,
  help,
}: {
  /** Rota da área em `PLATFORM_NAV` (fonte do texto de ajuda). */
  href: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  help?: ReactNode;
}) {
  const item = platformNavItem(href);
  return (
    <PageHeader
      title={title}
      description={description}
      actions={actions}
      helpSlot={
        <HelpPanel title={item?.label ?? title}>
          <div className="space-y-3 font-body text-sm text-text-mid">
            {item && <p>{item.help}</p>}
            {help}
            <p className="text-text-low">
              Esta é uma área de plataforma: o que você muda aqui vale para workspaces de clientes e
              fica registrado na auditoria.
            </p>
          </div>
        </HelpPanel>
      }
    />
  );
}
