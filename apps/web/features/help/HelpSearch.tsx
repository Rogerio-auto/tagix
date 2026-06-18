'use client';

/**
 * Busca da Central de Ajuda (F38-S05). Debounce simples; resultados FTS vindos
 * da API S03. Sem hex (DS v2), com estados loading/empty/error.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Search } from 'lucide-react';
import { useHelpArticles } from './queries';

export function HelpSearch() {
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim()), 250);
    return () => clearTimeout(t);
  }, [raw]);

  const enabled = q.length >= 2;
  const { data, isLoading, isError } = useHelpArticles(enabled ? { q } : {});
  const results = enabled ? (data?.articles ?? []) : [];

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low"
          aria-hidden
        />
        <input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Buscar na Central de Ajuda..."
          aria-label="Buscar artigos de ajuda"
          className="w-full rounded-lg border border-border bg-surface-2 py-3 pl-10 pr-4 font-body text-sm text-text outline-none transition-colors placeholder:text-text-low focus-visible:border-border-2 focus-visible:shadow-glow-md"
        />
      </div>

      {enabled && (
        <div className="mt-3 rounded-lg border border-border-2 bg-surface">
          {isLoading && <p className="px-4 py-3 text-sm text-text-low">Buscando...</p>}
          {isError && (
            <p className="px-4 py-3 text-sm text-danger">Falha na busca. Tente novamente.</p>
          )}
          {!isLoading && !isError && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-text-low">
              Nenhum artigo encontrado para esta busca.
            </p>
          )}
          <ul className="divide-y divide-border-2">
            {results.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/help/${a.slug}`}
                  className="flex items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md"
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-text-low" aria-hidden />
                  <span className="flex flex-col">
                    <span className="font-head text-sm font-medium text-text">{a.title}</span>
                    {a.excerpt && (
                      <span className="font-body text-xs text-text-mid">{a.excerpt}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
