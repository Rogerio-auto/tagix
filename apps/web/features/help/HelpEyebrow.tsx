import type { ReactNode } from 'react';

/** Rótulo de contexto em mono acima do título (padrão DS 3.0 das telas editoriais). */
export function HelpEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">{children}</p>
  );
}

/** Link "voltar" do topo das telas da Central (mesma receita do Portal do Desenvolvedor). */
export const backLinkClass =
  'inline-flex w-fit items-center gap-1.5 rounded-xs font-body text-sm font-bold text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:text-text focus-visible:focus-ring';
