import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { parseBlocks } from './parse';

export interface MarkdownProps {
  /** Corpo em Markdown (subconjunto seguro). Nunca interpretado como HTML cru. */
  children: string;
  className?: string;
}

/**
 * `Markdown` — render SANITIZADO de um subconjunto de Markdown como elementos
 * React (DS v2). Fonte unica usada pelo preview do CMS (F38-S04), pelo leitor da
 * Central de Ajuda (F38-S05), pelo help contextual (S06) e pelo Portal do Dev
 * (S13), garantindo que preview === publicado.
 *
 * Seguranca: o parser jamais emite HTML cru (sem dangerouslySetInnerHTML); todo
 * `<script>`/`<iframe>`/`on*`/`javascript:` do corpo vira texto literal. URLs de
 * links passam por allowlist de esquema. Ver `parse.tsx` / `sanitize.ts`.
 *
 * Estilo: prose tokenizada DS v2 (zero hex), legivel em dark-first.
 */
export function Markdown({ children, className }: MarkdownProps) {
  const nodes = useMemo(() => parseBlocks(children), [children]);
  return (
    <div
      className={cn(
        'font-body text-sm leading-relaxed text-text-mid',
        '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:font-head [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-text',
        '[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-head [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-text',
        '[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-head [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text',
        '[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:font-head [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-text',
        '[&_h5]:mb-1 [&_h5]:mt-4 [&_h5]:font-head [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:text-text',
        '[&_h6]:mb-1 [&_h6]:mt-4 [&_h6]:font-head [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-wide [&_h6]:text-text-mid',
        '[&_p]:my-3 first:[&_p]:mt-0',
        '[&_strong]:font-semibold [&_strong]:text-text',
        '[&_em]:italic',
        '[&_a]:text-brand [&_a]:underline-offset-4 [&_a:hover]:underline',
        '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul>li]:mt-1',
        '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol>li]:mt-1',
        '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-text-low [&_blockquote]:italic',
        '[&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-price [&_code]:text-[0.85em] [&_code]:text-text',
        '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border-2 [&_pre]:bg-surface-2 [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-text-mid',
        '[&_hr]:my-6 [&_hr]:border-border-2',
        className,
      )}
    >
      {nodes}
    </div>
  );
}
