import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  /** Uma linha de contexto sob o título (data, escopo, estado). Texto de apoio, não de ação. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Slot para o botão `?` (HelpPanel — UX §2.5). */
  helpSlot?: ReactNode;
}

/**
 * Cabeçalho de página no ritmo editorial do DS 3.0: título em head com tracking
 * negativo (21px no celular, 28px a partir de `md`), uma linha de apoio em `text-low`
 * e as ações alinhadas à base do bloco. Um `<h1>` por tela (F70-S32). Server-safe.
 */
export function PageHeader({ title, description, actions, helpSlot }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-8">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-head text-h4 text-text md:text-h3">{title}</h1>
          {helpSlot}
        </div>
        {description && <p className="mt-1.5 font-body text-small text-text-low">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
