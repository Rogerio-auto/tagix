'use client';

/**
 * Lista de artigos publicados de uma categoria (F38-S05). Aberta a partir de um
 * card da home (?category=). Volta para a home; cada item leva ao artigo.
 */
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { EmptyState } from '@/shared/components/feedback';
import { useHelpArticles, useHelpCategories } from './queries';

export function CategoryArticles({ categoryId }: { categoryId: string }) {
  const { data: catData } = useHelpCategories();
  const category = catData?.categories.find((c) => c.id === categoryId);
  const { data, isLoading, isError, refetch } = useHelpArticles({ category: categoryId });
  const articles = data?.articles ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1.5 font-head text-sm text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
      >
        <ArrowLeft className="size-4" aria-hidden /> Voltar a Central de Ajuda
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="font-head text-2xl font-semibold text-text">
          {category?.title ?? 'Categoria'}
        </h1>
        {category?.description && (
          <p className="font-body text-text-mid">{category.description}</p>
        )}
      </header>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-border bg-surface-2 px-5 py-4 text-center">
          <p className="text-sm text-danger">Falha ao carregar os artigos.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 font-head text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:shadow-glow-md"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!isLoading && !isError && articles.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Sem artigos publicados"
          description="Esta categoria ainda nao tem conteudo publicado."
        />
      )}

      <ul className="flex flex-col gap-2">
        {articles.map((a) => (
          <li key={a.id}>
            <Link
              href={`/help/${a.slug}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 px-5 py-4 outline-none transition-colors hover:border-border-2 hover:bg-surface-3 focus-visible:shadow-glow-md"
            >
              <FileText className="mt-0.5 size-5 shrink-0 text-text-low" aria-hidden />
              <span className="flex flex-col">
                <span className="font-head text-base font-medium text-text">{a.title}</span>
                {a.excerpt && (
                  <span className="font-body text-sm text-text-mid">{a.excerpt}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
