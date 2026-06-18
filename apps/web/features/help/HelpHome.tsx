'use client';

/**
 * Home da Central de Ajuda do membro (F38-S05). Busca + grade de categorias +
 * launcher de suporte. Conteudo publicado servido pela API S03. DS v2, sem hex,
 * responsivo (grade colapsa em mobile), estados loading/error/empty.
 */
import Link from 'next/link';
import { BookOpen, ChevronRight, LifeBuoy } from 'lucide-react';
import type { HelpCategoryWithCountDTO } from '@hm/shared';
import { EmptyState } from '@/shared/components/feedback';
import { HelpSearch } from './HelpSearch';
import { SupportLauncher } from './SupportLauncher';
import { useHelpCategories } from './queries';

export function HelpHome() {
  const { data, isLoading, isError, refetch } = useHelpCategories();
  const categories = data?.categories ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col items-center gap-3 pt-4 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-surface-2 text-brand">
          <LifeBuoy className="size-6" aria-hidden />
        </span>
        <h1 className="font-head text-3xl font-semibold text-text">Central de Ajuda</h1>
        <p className="max-w-lg font-body text-text-mid">
          Aprenda a tirar o maximo do Leadium. Busque um topico ou navegue pelas categorias.
        </p>
      </header>

      <HelpSearch />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-28 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-28 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-28 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-28 animate-pulse rounded-lg bg-surface-2" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-border bg-surface-2 px-5 py-6 text-center">
          <p className="font-body text-sm text-danger">Falha ao carregar as categorias.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded-md px-3 py-1.5 font-head text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:shadow-glow-md"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!isLoading && !isError && categories.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title="Ainda sem conteudo"
          description="A Central de Ajuda do Leadium esta sendo preparada. Volte em breve."
        />
      )}

      {categories.length > 0 && (
        <section aria-label="Categorias de ajuda" className="grid gap-4 sm:grid-cols-2">
          {categories.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </section>
      )}

      <SupportLauncher />
    </div>
  );
}

function CategoryCard({ category }: { category: HelpCategoryWithCountDTO }) {
  return (
    <Link
      href={`/help?category=${category.id}`}
      className="group flex items-start justify-between gap-4 rounded-lg border border-border bg-surface-2 px-5 py-4 outline-none transition-colors hover:border-border-2 hover:bg-surface-3 focus-visible:shadow-glow-md"
    >
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <BookOpen className="size-4 text-text-mid" aria-hidden />
          <span className="font-head text-base font-semibold text-text">{category.title}</span>
        </span>
        {category.description && (
          <span className="font-body text-sm text-text-mid">{category.description}</span>
        )}
        <span className="mt-1 font-body text-xs text-text-low">
          {category.publishedCount} {category.publishedCount === 1 ? 'artigo' : 'artigos'}
        </span>
      </span>
      <ChevronRight
        className="mt-1 size-5 shrink-0 text-text-low transition-transform group-hover:translate-x-0.5 group-hover:text-text"
        aria-hidden
      />
    </Link>
  );
}
