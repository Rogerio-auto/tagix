'use client';

/**
 * Home da Central de Ajuda do membro (F38-S05; DS 3.0 na F72-S08). Busca + grade de
 * categorias + launcher de suporte. Conteúdo publicado servido pela API S03. Sem hex,
 * responsiva (a grade colapsa no celular), estados carregando/erro/vazio.
 */
import Link from 'next/link';
import { ArrowRight, BookOpen, LifeBuoy } from 'lucide-react';
import type { HelpCategoryWithCountDTO } from '@hm/shared';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { formatNumber } from '@/shared/lib/locale';
import { HelpSearch } from './HelpSearch';
import { SupportLauncher } from './SupportLauncher';
import { useHelpCategories } from './queries';
import { HelpEyebrow } from './HelpEyebrow';

export function HelpHome() {
  const { data, isLoading, isError, error, refetch } = useHelpCategories();
  const categories = data?.categories ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-text-mid">
            <LifeBuoy className="size-6" aria-hidden strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <HelpEyebrow>Ajuda · Leadium</HelpEyebrow>
            <h1 className="font-head text-h3 text-text md:text-h2">Central de Ajuda</h1>
            <p className="max-w-xl font-body text-body text-text-mid">
              Aprenda a tirar o máximo do Leadium. Busque um tópico ou navegue pelas categorias.
            </p>
          </div>
        </div>
      </header>

      <HelpSearch />

      <section aria-labelledby="help-categorias" className="flex flex-col gap-4">
        <h2
          id="help-categorias"
          className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low"
        >
          Categorias
        </h2>

        {isLoading && (
          <div role="status" aria-busy="true" className="grid gap-3 sm:grid-cols-2">
            <span className="sr-only">Carregando categorias</span>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-lg" />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState
            error={error}
            title="Não foi possível carregar as categorias"
            reason="A Central de Ajuda não respondeu agora."
            whatToDo="Tente de novo em instantes."
            action={
              <Button variant="secondary" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!isLoading && !isError && categories.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="Ainda sem conteúdo"
            description="A Central de Ajuda do Leadium está sendo preparada. Volte em breve."
          />
        )}

        {categories.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.id} className="flex">
                <CategoryCard category={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <SupportLauncher />
    </div>
  );
}

function CategoryCard({ category }: { category: HelpCategoryWithCountDTO }) {
  const count = category.publishedCount;
  return (
    <Link
      href={`/help?category=${category.id}`}
      className="group flex w-full flex-col justify-between gap-6 rounded-lg border border-border bg-surface p-5 shadow-ds-1 outline-none transition-[border-color,background-color,transform,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 hover:bg-surface-2 hover:shadow-ds-2 focus-visible:focus-ring motion-safe:hover:-translate-y-0.5"
    >
      <span className="flex flex-col gap-1.5">
        <span className="font-head text-h4 text-text">{category.title}</span>
        {category.description && (
          <span className="font-body text-sm text-text-mid">{category.description}</span>
        )}
      </span>
      <span className="flex items-center justify-between gap-4">
        <span className="font-mono text-xs tabular-nums text-text-low">
          {formatNumber(count)} {count === 1 ? 'artigo' : 'artigos'}
        </span>
        <ArrowRight
          className="size-4 shrink-0 text-text-low transition-[transform,color] duration-(--dur-base) ease-ds group-hover:text-text motion-safe:group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}
