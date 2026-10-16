'use client';

/**
 * Lista de artigos do CMS de Ajuda (F38-S04; DS 3.0 na F72-S08) com reordenação por
 * setas (sobe/desce) — acessível por teclado, sem drag-and-drop obrigatório. Mostra o
 * status (rascunho/publicado) e seleciona o artigo no editor. Mesmas chamadas de antes.
 */
import { ChevronDown, ChevronUp, FilePlus2, FileText } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, IconButton, Skeleton } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { eyebrowClass } from '../ui/kit';
import { useHelpArticles, useReorderArticles } from './queries';

interface Props {
  categoryId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ArticleList({ categoryId, selectedId, onSelect, onNew }: Props) {
  const { data, isLoading, isError, isFetching, refetch } = useHelpArticles(categoryId ?? undefined);
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
    <section aria-labelledby="help-articles" className="flex w-full flex-col gap-2 lg:w-80 lg:shrink-0">
      <div className="flex min-h-8 items-center justify-between gap-2 px-1">
        <h2 id="help-articles" className={eyebrowClass}>
          Artigos
        </h2>
        <Button variant="secondary" size="sm" leftIcon={<FilePlus2 className="size-4" aria-hidden />} onClick={onNew}>
          Novo artigo
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label="Carregando artigos" className="flex flex-col gap-2 p-3">
            <Skeleton className="h-14 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
          </div>
        ) : isError ? (
          <ErrorState
            title="Não foi possível carregar os artigos"
            reason="A lista de artigos não respondeu."
            whatToDo="Tente de novo em instantes."
            action={
              <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
                Tentar de novo
              </Button>
            }
          />
        ) : articles.length === 0 ? (
          <EmptyState
            className="py-10"
            icon={FileText}
            title="Nenhum artigo"
            description="Crie o primeiro artigo desta visão para começar."
          />
        ) : (
          <ul className="divide-y divide-border">
            {articles.map((a, i) => {
              const active = selectedId === a.id;
              return (
                <li key={a.id} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelect(a.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-left outline-none transition-colors duration-(--dur-fast) focus-visible:focus-ring',
                      active ? 'bg-surface-2 shadow-[inset_2px_0_0_var(--brand-text)]' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-body text-sm font-semibold text-text">{a.title}</span>
                      <Badge tone={a.status === 'published' ? 'brand' : 'neutral'} size="sm">
                        {a.status === 'published' ? 'Publicado' : 'Rascunho'}
                      </Badge>
                    </span>
                    {a.excerpt && <span className="truncate font-body text-sm text-text-low">{a.excerpt}</span>}
                  </button>
                  <div className="flex flex-col justify-center border-l border-border px-1">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<ChevronUp aria-hidden />}
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || reorder.isPending}
                      aria-label={`Mover ${a.title} para cima`}
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<ChevronDown aria-hidden />}
                      onClick={() => move(i, 1)}
                      disabled={i === articles.length - 1 || reorder.isPending}
                      aria-label={`Mover ${a.title} para baixo`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
