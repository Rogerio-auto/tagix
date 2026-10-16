import type { ReactNode } from 'react';

/**
 * Documento público de leitura longa (termos, privacidade), DS 3.0 (F72-S08).
 *
 * Tipografia editorial: corpo em 17px com entrelinha 1,75 e medida de ~68 caracteres;
 * títulos de seção em Space Grotesk com o número da seção em mono; índice "Nesta
 * página" fixo ao lado no desktop (âncoras com ids ASCII) e no topo no celular.
 * Server Component: nenhum JS para ler um termo.
 */

export interface LegalSection {
  /** Âncora ASCII (vira `#id` no índice). */
  id: string;
  title: string;
  body: ReactNode;
}

export interface LegalDocumentProps {
  eyebrow: string;
  title: string;
  /** Linha de data ("Atualizada em 14 de setembro de 2026"). */
  updated: string;
  lead?: ReactNode;
  sections: readonly LegalSection[];
}

/** Classe de link dentro do texto corrido (contraste ≥4,5 nos dois temas). */
export const proseLinkClass =
  'rounded-xs font-semibold text-brand-text underline decoration-border-brand underline-offset-4 outline-none transition-colors duration-(--dur-fast) ease-ds hover:decoration-brand-text focus-visible:focus-ring';

export function LegalDocument({ eyebrow, title, updated, lead, sections }: LegalDocumentProps) {
  return (
    <article className="flex flex-col gap-12 md:gap-16">
      <header className="flex max-w-3xl flex-col gap-5">
        <p className="flex items-center gap-2.5 font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">
          <span aria-hidden className="h-px w-5 bg-border-2" />
          {eyebrow}
        </p>
        <h1 className="font-head text-h2 text-balance text-text md:text-h1">{title}</h1>
        {lead && <p className="max-w-[60ch] font-body text-lg leading-[1.7] text-text-mid">{lead}</p>}
        <p className="font-mono text-xs text-text-low">{updated}</p>
      </header>

      <div className="grid gap-10 border-t border-border pt-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 lg:pt-12">
        <nav aria-label="Nesta página" className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">
            Nesta página
          </p>
          <ol className="flex flex-col border-l border-border">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="-ml-px flex gap-3 border-l border-transparent py-1.5 pl-4 pr-2 font-body text-sm text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:border-text-mid hover:text-text focus-visible:focus-ring"
                >
                  <span className="font-mono text-xs tabular-nums leading-5 text-text-low">{indexLabel(i)}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex max-w-[68ch] flex-col gap-12">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-titulo`} className="scroll-mt-24">
              <h2 id={`${s.id}-titulo`} className="flex items-baseline gap-4 font-head text-h4 text-text md:text-h3">
                <span aria-hidden className="font-mono text-sm font-medium tabular-nums text-text-low">
                  {indexLabel(i)}
                </span>
                {s.title}
              </h2>
              <div className="mt-4 flex flex-col gap-4 font-body text-[1.0625rem] leading-[1.75] text-text-mid [&_li]:pl-1 [&_strong]:font-bold [&_strong]:text-text [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-3 [&_ul]:pl-5 [&_ul]:marker:text-text-low">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

function indexLabel(i: number): string {
  return String(i + 1).padStart(2, '0');
}
