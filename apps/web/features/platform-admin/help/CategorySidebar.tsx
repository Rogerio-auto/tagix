'use client';

/**
 * Coluna de categorias do CMS de Ajuda (F38-S04; DS 3.0 na F72-S08). Lista categorias,
 * permite criar/editar/excluir e filtra a lista de artigos. Mesmas chamadas e o MESMO
 * `confirm` antes de excluir (UX §2.9). Editar/excluir aparecem no hover e no foco; no
 * toque ficam sempre visíveis (não há hover).
 */
import { useState } from 'react';
import { FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import type { HelpCategoryDTO } from '@hm/shared';
import { Button, IconButton, Skeleton } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { eyebrowClass } from '../ui/kit';
import {
  useCreateCategory,
  useDeleteCategory,
  useHelpCategories,
  useUpdateCategory,
} from './queries';

interface Props {
  selected: string | null;
  onSelect: (id: string | null) => void;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 160);
}

const itemClass = (active: boolean) =>
  cn(
    'flex min-h-10 w-full min-w-0 items-center rounded-sm px-3 text-left font-head text-sm font-medium outline-none',
    'transition-colors duration-(--dur-fast) focus-visible:focus-ring',
    active ? 'bg-surface-2 text-text shadow-[inset_2px_0_0_var(--brand-text)]' : 'text-text-mid hover:bg-surface-2 hover:text-text',
  );

const revealClass =
  'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity duration-(--dur-fast)';

export function CategorySidebar({ selected, onSelect }: Props) {
  const { data, isLoading, isError, isFetching, refetch } = useHelpCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [title, setTitle] = useState('');

  const categories = data?.categories ?? [];

  function startNew(): void {
    setEditing('new');
    setTitle('');
  }
  function startEdit(c: HelpCategoryDTO): void {
    setEditing(c.id);
    setTitle(c.title);
  }
  async function save(): Promise<void> {
    const t = title.trim();
    if (t === '') return;
    if (editing === 'new') {
      await create.mutateAsync({ slug: slugify(t), title: t });
    } else if (editing) {
      await update.mutateAsync({ id: editing, patch: { title: t } });
    }
    setEditing(null);
  }

  return (
    <aside aria-labelledby="help-categories" className="flex w-full flex-col gap-2 lg:w-60 lg:shrink-0">
      <div className="flex min-h-8 items-center justify-between gap-2 px-1">
        <h2 id="help-categories" className={eyebrowClass}>
          Categorias
        </h2>
        <IconButton variant="ghost" size="sm" icon={<FolderPlus aria-hidden />} aria-label="Nova categoria" onClick={startNew} />
      </div>

      {isLoading && <Skeleton className="h-10 w-full rounded-sm" />}
      {isError && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger/10 p-3">
          <p className="font-body text-sm text-text">Não foi possível carregar as categorias.</p>
          <Button variant="secondary" size="sm" className="self-start" loading={isFetching} onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      )}

      <ul className="flex flex-col gap-0.5">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-current={selected === null ? 'true' : undefined}
            className={itemClass(selected === null)}
          >
            Todos os artigos
          </button>
        </li>
        {categories.map((c) =>
          editing === c.id ? (
            <li key={c.id}>
              <CategoryEdit
                value={title}
                onChange={setTitle}
                onSave={() => void save()}
                onCancel={() => setEditing(null)}
                busy={update.isPending}
              />
            </li>
          ) : (
            <li key={c.id} className="group flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={selected === c.id ? 'true' : undefined}
                className={cn(itemClass(selected === c.id), 'flex-1')}
              >
                <span className="truncate">{c.title}</span>
              </button>
              <IconButton
                variant="ghost"
                size="sm"
                className={revealClass}
                icon={<Pencil aria-hidden />}
                onClick={() => startEdit(c)}
                aria-label={`Editar categoria ${c.title}`}
              />
              <IconButton
                variant="danger"
                size="sm"
                className={revealClass}
                icon={<Trash2 aria-hidden />}
                onClick={() => {
                  if (confirm(`Excluir a categoria "${c.title}" e seus artigos?`)) {
                    void remove.mutateAsync(c.id).then(() => {
                      if (selected === c.id) onSelect(null);
                    });
                  }
                }}
                aria-label={`Excluir categoria ${c.title}`}
              />
            </li>
          ),
        )}
        {editing === 'new' && (
          <li>
            <CategoryEdit
              value={title}
              onChange={setTitle}
              onSave={() => void save()}
              onCancel={() => setEditing(null)}
              busy={create.isPending}
            />
          </li>
        )}
      </ul>

      {!isLoading && categories.length === 0 && editing === null && (
        <p className="px-3 py-2 font-body text-sm text-text-low">Nenhuma categoria ainda.</p>
      )}
      {editing === null && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          leftIcon={<FolderPlus className="size-4" aria-hidden />}
          onClick={startNew}
        >
          Nova categoria
        </Button>
      )}
    </aside>
  );
}

function CategoryEdit({
  value,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-sm border border-brand-text/40 bg-surface-2 p-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Nome da categoria"
        aria-label="Nome da categoria"
        className="min-w-0 flex-1 bg-transparent px-2 py-1 font-body text-base text-text outline-none placeholder:text-text-low sm:text-sm"
      />
      <Button variant="secondary" size="sm" onClick={onSave} loading={busy}>
        Salvar
      </Button>
      <IconButton variant="ghost" size="sm" icon={<X aria-hidden />} onClick={onCancel} aria-label="Cancelar" />
    </div>
  );
}
