'use client';

/**
 * CMS da Central de Ajuda (F38-S04) — painel super-admin. Layout master-detail:
 * categorias | lista de artigos | editor com preview Markdown sanitizado.
 * Conteudo e PLATFORM-LEVEL (Leadium escreve, todos os workspaces leem).
 */
import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { ArticleEditor } from './ArticleEditor';
import { ArticleList } from './ArticleList';
import { CategorySidebar } from './CategorySidebar';
import { useHelpArticle, useHelpCategories } from './queries';

export function HelpCms() {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: catData } = useHelpCategories();
  const categories = catData?.categories ?? [];
  const { data: artData } = useHelpArticle(creating ? null : selectedId);
  const article = creating ? null : (artData?.article ?? null);

  const defaultCategoryId = categoryId ?? categories[0]?.id ?? '';
  const editorVisible = creating || selectedId !== null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-md bg-surface-2 text-text-mid">
          <LifeBuoy className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="font-head text-2xl font-semibold text-text">Central de Ajuda</h1>
          <p className="font-body text-sm text-text-mid">
            Conteudo de ajuda do Leadium — escrito aqui, lido por todos os workspaces.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <CategorySidebar
          selected={categoryId}
          onSelect={(id) => {
            setCategoryId(id);
            setSelectedId(null);
            setCreating(false);
          }}
        />
        <ArticleList
          categoryId={categoryId}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setCreating(false);
          }}
          onNew={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        />
        {editorVisible ? (
          <ArticleEditor
            key={creating ? 'new' : (selectedId ?? 'none')}
            article={article}
            isNew={creating}
            categories={categories}
            defaultCategoryId={defaultCategoryId}
            onSaved={(id) => {
              setCreating(false);
              setSelectedId(id);
            }}
            onDeleted={() => {
              setCreating(false);
              setSelectedId(null);
            }}
          />
        ) : (
          <section className="flex min-w-0 flex-1 items-center justify-center rounded-md border border-dashed border-border-2 px-6 py-16 text-center">
            <p className="max-w-sm font-body text-sm text-text-low">
              Selecione um artigo a esquerda para editar, ou crie um novo para comecar.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
