import type * as React from 'react';
import { Clapperboard, Megaphone, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Badge } from '@hm/ui';

/**
 * Lugar reservado para o que ainda não existe (Content Studio, Approvals e Ads
 * performance — fases F62 a F66 e F69). Não tem número, link nem dado inventado: só
 * marca onde cada um vai morar, para a Home não precisar ser redesenhada quando
 * chegarem. Silencioso de propósito (hairline pontilhada, texto de apoio).
 */
const SLOTS: readonly { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Clapperboard, title: 'Content Studio', text: 'Posts e reels da semana' },
  { icon: ShieldCheck, title: 'Aprovações', text: 'Conteúdo aguardando o seu ok' },
  { icon: Megaphone, title: 'Anúncios', text: 'Custo por lead e campanhas' },
];

export function ReservedSlots(): React.JSX.Element {
  return (
    // Container query, não viewport: em 768 o bloco tem ~520px (a sidebar come o resto),
    // e três colunas ali esmagavam título e selo. Mesmo critério do KpiStrip.
    <section aria-label="Em breve nesta tela" className="@container">
      <ul className="grid grid-cols-1 gap-3 @3xl:grid-cols-3">
        {SLOTS.map(({ icon: Icon, title, text }) => (
          <li
            key={title}
            className="flex items-center gap-3 rounded-lg border border-dashed border-border-2 px-4 py-3"
          >
            <Icon aria-hidden className="size-4 shrink-0 text-text-low" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-body text-sm font-bold text-text-mid">
                {title}
              </span>
              <span className="block truncate font-body text-sm text-text-low">{text}</span>
            </span>
            {/* O Badge já é `shrink-0` na base (@hm/ui): o selo nunca cede, o título trunca. */}
            <Badge tone="neutral" size="sm">
              Em breve
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
