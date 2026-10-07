import type { ReactNode } from 'react';

/**
 * Só para stories/catalogo: renderiza o mesmo conteúdo lado a lado nos dois temas
 * (DoD do DS 3.0: "nos dois temas"). Os tokens trocam por `data-theme` no wrapper,
 * então não depende do toggle do Ladle. Componentes em portal (Modal, Drawer, Toast)
 * seguem o tema do documento — para eles use o toggle do Ladle.
 */
export function ThemePair({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(['dark', 'light'] as const).map((theme) => (
        <div
          key={theme}
          data-theme={theme}
          className="rounded-xl border border-border bg-bg p-6 font-body text-text"
        >
          <p className="mb-4 font-price text-xs uppercase tracking-wider text-text-low">{theme}</p>
          {children}
        </div>
      ))}
    </div>
  );
}
