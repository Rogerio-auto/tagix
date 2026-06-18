'use client';

/**
 * Lista de artigos do CMS de Ajuda (F38-S04) com reordenacao por setas (sobe/
 * desce) — acessivel por teclado, sem drag-and-drop obrigatorio. Mostra status
 * (rascunho/publicado) e seleciona o artigo no editor.
 */
import { ChevronDown, ChevronUp, FilePlus2, FileText } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, Skeleton } from '@/shared/components/feedback';
import { useHelpArticles, useReorderArticles } from './queries';

interface Props {
  categoryId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ArticleList({ categoryId, selectedId, onSelect, onNew }: Props) {
  const { data, isLoading, isError, refetch } = useHelpArticles(categoryId ?? undefined);
  const reorder = useReorderArticles();
  const articles = data?.articles ?? [];

  function move(index: number, dir: -1 | 1): void {
    const next = index + dir;
    if (next < 0 || next >= articles.length) return;
    const a = articles[index];
    const b = articles[next];
    if (!a || !b) return;
    void reorder.mutateAsync([
      { id: a.id, order: b.order },
      { id: b.id, order: a.order },
    ]);
  }

  return (
    <div className="flex w-full flex-col gap-2 lg:w-80 lg:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="font-head text-sm font-semibold uppercase tracking-wide text-text-low">
          Artigos
        </h2>
        <Button variant="secondary" size="sm" onClick={onNew}>
          <FilePlus2 className="size-4" aria-hidden /> Novo
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {isError && (
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-md border border-border px-3 py-2 text-left text-sm text-danger outline-none hover:bg-surface-2 focus-visible:shadow-glow-md"
        >
          Falha ao carregar artigos. Tentar de novo.
        </button>
      )}

      {!isLoading && !isError && articles.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Nenhum artigo"
          description="Crie o primeiro artigo desta visao para comecar a Central de Ajuda."
          action={
            <Button variant="primary" size="sm" onClick={onNew}>
              <FilePlus2 className="size-4" aria-hidden /> Criar artigo
            </Button>
          }
        />
      )}

      <ul className="flex flex-col gap-1">
        {articles.map((a, i) => (
          <li key={a.id} className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              aria-current={selectedId === a.id ? 'true' : undefined}
              className={
                selectedId === a.id
                  ? 'flex flex-1 flex-col gap-0.5 rounded-md border border-border-2 bg-surface-3 px-3 py-2 text-left outline-none focus-visible:shadow-glow-md'
                  : 'flex flex-1 flex-col gap-0.5 rounded-md border border-transparent px-3 py-2 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:shadow-glow-md'
              }
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-head text-sm font-medium text-text">{a.title}</span>
                <StatusDot status={a.status} />
              </span>
              {a.excerpt && (
                <span className="truncate font-body text-xs text-text-low">{a.excerpt}</span>
              )}
            </button>
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0 || reorder.isPending}
                aria-label={'Mover ' + a.title + ' para cima'}
                className="rounded-sm p-0.5 text-text-low outline-none transition hover:text-text focus-visible:shadow-glow-md disabled:opacity-30"
              >
                <ChevronUp className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === articles.length - 1 || reorder.isPending}
                aria-label={'Mover ' + a.title + ' para baixo'}
                className="rounded-sm p-0.5 text-text-low outline-none transition hover:text-text focus-visible:shadow-glow-md disabled:opacity-30"
              >
                <ChevronDown className="size-4" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusDot({ status }: { status: 'draft' | 'published' }) {
  const published = status === 'published';
  return (
    <span
      className={
        published
          ? 'ml-auto inline-flex shrink-0 items-center gap-1 rounded-pill bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand'
          : 'ml-auto inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-low'
      }
    >
      {published ? 'Publicado' : 'Rascunho'}
    </span>
  );
}
