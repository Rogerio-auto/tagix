import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
  /** Slot para o botão `?` (HelpPanel — UX §2.5; componente vem em F0-S12). */
  helpSlot?: ReactNode;
}

export function PageHeader({ title, actions, helpSlot }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <h1 className="font-head text-2xl font-semibold text-text">{title}</h1>
        {helpSlot}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
