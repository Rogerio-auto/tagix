'use client';

import { HelpHint as UIHelpHint } from '@hm/ui';
import { getHelp, type HelpKey } from '@/shared/lib/help-content';

export interface HelpHintProps {
  /** Chave tipada no registry `help-content.ts`. */
  k: HelpKey;
  className?: string;
}

/**
 * Gatilho `?` inline alimentado pelo registry tipado de ajuda.
 *
 * Uso: `<HelpHint k="dashboard.overview" />` ao lado do nome de uma seção.
 * Liga `help-content.ts` (conteúdo) ao `HelpHint` do DS (`@hm/ui`, apresentação).
 * `k` é validado em tempo de compilação — chave inexistente não compila.
 *
 * UX §3.3 (help inline `?`) + §3.2 (drawer lateral, não modal). Evita §2.5
 * (tooltip-substituto) e §2.4 (caça ao tesouro: `?` sempre visível).
 */
export function HelpHint({ k, className }: HelpHintProps) {
  const { title, body, link } = getHelp(k);
  return <UIHelpHint title={title} body={body} link={link} className={className} />;
}
