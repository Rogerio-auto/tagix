'use client';

/**
 * Lista de artigos publicados de uma categoria (F38-S05; DS 3.0 na F72-S08). Aberta a
 * partir de um card da home (?category=). Volta para a home; cada linha leva ao artigo
 * (a linha inteira é o alvo, UX §2.1).
 */
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { formatNumber } from '@/shared/lib/locale';
import { HelpEyebrow, backLinkClass } from './HelpEyebrow';
import { useHelpArticles, useHelpCategories } from './queries';

export function CategoryArticles({ categoryId }: { categoryId: string }) {
  const { data: catData } = useHelpCategories();
  const category = catData?.categories.find((c) => c.id === categoryId);
  const { data, isLoading, isError, error, refetch } = useHelpArticles({ category: categoryId });
  const articles = data?.articles ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <Link href="/help" className={backLinkClass}>
        <ArrowLeft className="size-4" aria-hidden /> Voltar à Central de Ajuda
      </Link>

      <header className="flex flex-col gap-1.5">
        <HelpEyebrow>
          Categoria
          {!isLoading && !isError && articles.length > 0 && (
            <>
              {' · '}
              <span className="tabular-nums">{formatNumber(articles.length)}</span>{' '}
              {articles.length === 1 ? 'artigo' : 'artigos'}
            </>
          )}
        </HelpEyebrow>
        <h1 className="font-head text-h3 text-text md:text-h2">{category?.title ?? 'Categoria'}</h1>
        {category?.description && (
          <p className="max-w-[60ch] font-body text-body text-text-mid">{category.description}</p>
        )}
      </header>

      {isLoading && (
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Carregando artigos</span>
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      )}

      {isError && (
        <ErrorState
          error={error}
          title="Não foi possível carregar os artigos"
          reason="A Central de Ajuda não respondeu agora."
          whatToDo="Tente de novo em instantes."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!isLoading && !isError && articles.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Sem artigos publicados"
          description="Esta categoria ainda não tem conteúdo publicado."
        />
      )}

      {articles.length > 0 && (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-ds-1">
          {articles.map((a, i) => (
            <li key={a.id}>
              <Link
                href={`/help/${a.slug}`}
                className="group flex items-center gap-5 px-5 py-4 outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:focus-ring focus-visible:-outline-offset-2"
              >
                <span aria-hidden className="w-6 shrink-0 font-mono text-xs tabular-nums text-text-low">
                  {String(i + 1).padStart(2, '0')}
                </span>
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
        </ol>
      )}
    </div>
  );
}
