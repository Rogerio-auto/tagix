'use client';

/**
 * Coluna de categorias do CMS de Ajuda (F38-S04). Lista categorias, permite
 * criar/editar/excluir e filtra a lista de artigos. Sem nenhum hex (DS v2).
 */
import { useState } from 'react';
import { FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import type { HelpCategoryDTO } from '@hm/shared';
import { Button } from '@hm/ui';
import { Skeleton } from '@/shared/components/feedback';
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

export function CategorySidebar({ selected, onSelect }: Props) {
  const { data, isLoading, isError, refetch } = useHelpCategories();
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
    <aside className="flex w-full flex-col gap-2 lg:w-64 lg:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="font-head text-sm font-semibold uppercase tracking-wide text-text-low">
          Categorias
        </h2>
        <button
          type="button"
          onClick={startNew}
          aria-label="Nova categoria"
          className="rounded-sm p-1 text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
        >
          <FolderPlus className="size-4" aria-hidden />
        </button>
      </div>

      {isLoading && <Skeleton className="h-9 w-full" />}
      {isError && (
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-sm border border-border px-3 py-2 text-left text-sm text-danger outline-none hover:bg-surface-2 focus-visible:shadow-glow-md"
        >
          Falha ao carregar. Tentar de novo.
        </button>
      )}

      <ul className="flex flex-col gap-0.5">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-current={selected === null ? 'true' : undefined}
            className={`w-full rounded-sm px-3 py-2 text-left font-head text-sm outline-none transition-colors focus-visible:shadow-glow-md ${
              selected === null
                ? 'bg-surface-3 text-text'
                : 'text-text-mid hover:bg-surface-2 hover:text-text'
            }`}
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
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={selected === c.id ? 'true' : undefined}
                className={`flex-1 rounded-sm px-3 py-2 text-left font-head text-sm outline-none transition-colors focus-visible:shadow-glow-md ${
                  selected === c.id
                    ? 'bg-surface-3 text-text'
                    : 'text-text-mid hover:bg-surface-2 hover:text-text'
                }`}
              >
                {c.title}
              </button>
              <button
                type="button"
                onClick={() => startEdit(c)}
                aria-label={`Editar categoria ${c.title}`}
                className="rounded-sm p-1 text-text-low opacity-0 outline-none transition hover:text-text focus-visible:opacity-100 focus-visible:shadow-glow-md group-hover:opacity-100"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Excluir a categoria "${c.title}" e seus artigos?`)) {
                    void remove.mutateAsync(c.id).then(() => {
                      if (selected === c.id) onSelect(null);
                    });
                  }
                }}
                aria-label={`Excluir categoria ${c.title}`}
                className="rounded-sm p-1 text-text-low opacity-0 outline-none transition hover:text-danger focus-visible:opacity-100 focus-visible:shadow-glow-md group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
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
        <p className="px-3 py-2 text-sm text-text-low">Nenhuma categoria ainda.</p>
      )}
      {editing === null && (
        <Button variant="ghost" size="sm" onClick={startNew} className="mt-1 self-start">
          <FolderPlus className="size-4" aria-hidden /> Nova categoria
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
    <div className="flex items-center gap-1 rounded-sm border border-border-2 bg-surface-2 p-1">
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
        className="min-w-0 flex-1 bg-transparent px-2 py-1 font-body text-sm text-text outline-none placeholder:text-text-low"
      />
      <Button variant="primary" size="sm" onClick={onSave} loading={busy}>
        OK
      </Button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancelar"
        className="rounded-sm p-1 text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
