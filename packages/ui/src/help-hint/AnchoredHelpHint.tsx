'use client';

import { useCallback, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '../lib/cn';
import { HelpPanel } from '../HelpHint/HelpHint';
import { Markdown } from '../Markdown/Markdown';
import { defaultAnchoredHelpFetcher } from './fetcher';
import type { AnchoredHelpArticle, AnchoredHelpFetcher } from './types';

export interface AnchoredHelpHintProps {
  /** Chave estavel do artigo (ex.: "agents.list"). Resolve via API S03. */
  anchorKey: string;
  /** Base do link "ver artigo completo" no leitor. Default: /help. */
  helpBasePath?: string;
  /** Resolver injetavel (testes). Default: fetch same-origin. */
  fetcher?: AnchoredHelpFetcher;
  /** aria-label do gatilho `?`. Default deriva do anchorKey ate carregar. */
  triggerLabel?: string;
  className?: string;
}

/**
 * `AnchoredHelpHint` — gatilho `?` que, ao abrir, busca um artigo publicado por
 * `anchorKey` (CMS de Ajuda, F38) e mostra titulo + resumo + corpo SANITIZADO
 * num drawer lateral (reusa `HelpPanel`), com link "ver artigo completo" no
 * leitor `/help`. Fallback SILENCIOSO: se nao houver artigo publicado para a
 * ancora, o painel mostra um aviso curto e nada quebra.
 *
 * Lazy: so consulta a API quando o usuario abre o `?` (sem custo no load).
 * Render do corpo via `Markdown` (mesmo sanitizador do leitor/CMS).
 */
export function AnchoredHelpHint({
  anchorKey,
  helpBasePath = '/help',
  fetcher = defaultAnchoredHelpFetcher,
  triggerLabel,
  className,
}: AnchoredHelpHintProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'loaded'>('idle');
  const [article, setArticle] = useState<AnchoredHelpArticle | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    const result = await fetcher(anchorKey);
    setArticle(result);
    setState('loaded');
  }, [anchorKey, fetcher]);

  const onOpen = useCallback(() => {
    setOpen(true);
    if (state === 'idle') void load();
  }, [state, load]);

  const title = article?.title ?? 'Ajuda';

  const body =
    state === 'loading' ? (
      <p className="text-sm text-text-low">Carregando ajuda...</p>
    ) : article ? (
      <div className="flex flex-col gap-3">
        {article.excerpt && <p className="text-sm text-text-mid">{article.excerpt}</p>}
        <Markdown>{article.bodyMd}</Markdown>
      </div>
    ) : (
      <p className="text-sm text-text-low">
        Ainda nao ha um artigo de ajuda para esta secao. Visite a Central de Ajuda para mais
        conteudo.
      </p>
    );

  const link = article
    ? { label: 'Ver artigo completo', href: `${helpBasePath}/${article.slug}` }
    : { label: 'Abrir a Central de Ajuda', href: helpBasePath };

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel ?? `Ajuda sobre ${anchorKey}`}
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-pill text-text-low outline-none',
          'transition-colors duration-150 hover:bg-surface-2 hover:text-text',
          'focus-visible:shadow-glow-md',
          className,
        )}
      >
        <HelpCircle className="size-4" aria-hidden />
      </button>
      <HelpPanel open={open} onClose={() => setOpen(false)} title={title} body={body} link={link} />
    </>
  );
}
