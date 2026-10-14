import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface PanelProps {
  /** Id do título: vira o rótulo acessível da região. */
  id: string;
  /** Linha mono em caixa-alta acima do título ("30 dias", "agora"). */
  eyebrow?: string;
  title: string;
  /** Conteúdo à direita do cabeçalho (contagem, link, ação). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Sem divisória sob o cabeçalho (gráficos que abrem direto na área). */
  flush?: boolean;
}

/**
 * Superfície de bloco da Home. Hairline primeiro, sombra nunca: a elevação do DS 3.0
 * sobe só ao interagir. Cabeçalho com eyebrow mono + título em head, como a maquete.
 */
export function Panel({
  id,
  eyebrow,
  title,
  aside,
  children,
  className,
  flush = false,
}: PanelProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn('min-w-0 rounded-lg border border-border bg-surface', className)}
    >
      <header
        className={cn(
          'flex items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-6 sm:pt-5',
          !flush && 'border-b border-border',
        )}
      >
        <div className="min-w-0">
          {eyebrow && (
            <p className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
              {eyebrow}
            </p>
          )}
          <h2 id={id} className="font-head text-lg font-semibold tracking-tight text-text">
            {title}
          </h2>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
