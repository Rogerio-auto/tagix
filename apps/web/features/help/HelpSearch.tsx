'use client';

/**
 * Busca da Central de Ajuda (F38-S05; DS 3.0 na F72-S08). Debounce simples; resultados
 * FTS vindos da API S03. Estados carregando/vazio/erro, contagem anunciada ao leitor de
 * tela e atalho `/` para focar o campo (UX §2.10).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { formatNumber } from '@/shared/lib/locale';
import { useHelpArticles } from './queries';

/** Digitando em outro campo, o `/` é texto, não atalho. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function HelpSearch() {
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim()), 250);
    return () => clearTimeout(t);
  }, [raw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const enabled = q.length >= 2;
  const { data, isLoading, isError } = useHelpArticles(enabled ? { q } : {});
  const results = enabled ? (data?.articles ?? []) : [];

  const status = !enabled
    ? ''
    : isLoading
      ? 'Buscando…'
      : isError
        ? 'Falha na busca. Tente novamente.'
        : results.length === 0
          ? 'Nenhum artigo encontrado para esta busca.'
          : `${formatNumber(results.length)} ${results.length === 1 ? 'artigo encontrado' : 'artigos encontrados'}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-low"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Buscar na Central de Ajuda"
          aria-label="Buscar artigos de ajuda"
          aria-keyshortcuts="/"
          className="h-14 w-full rounded-md border border-border bg-surface-2 pl-12 pr-14 font-body text-base text-text shadow-ds-1 outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds placeholder:text-text-low hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-xs border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-text-low md:block"
        >
          /
        </kbd>
      </div>

      {/* Região viva sempre montada: a contagem/estado da busca é anunciada. */}
      <p role="status" className="font-mono text-xs text-text-low empty:hidden">
        {status}
      </p>

      {enabled && results.length > 0 && (
        <ul
          aria-label="Resultados da busca"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-ds-1"
        >
          {results.map((a) => (
            <li key={a.id}>
              <Link
                href={`/help/${a.slug}`}
                className="group flex items-center gap-4 px-5 py-4 outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:focus-ring focus-visible:-outline-offset-2"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-body font-bold text-text">{a.title}</span>
                  {a.excerpt && <span className="font-body text-sm text-text-mid">{a.excerpt}</span>}
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-text-low transition-[transform,color] duration-(--dur-base) ease-ds group-hover:text-text motion-safe:group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
