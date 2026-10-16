'use client';

/**
 * CMS da Central de Ajuda (F38-S04) no DS 3.0 (F72-S08) — painel super-admin. Layout
 * master-detail: categorias | artigos | editor com preview Markdown sanitizado.
 * Conteúdo é PLATFORM-LEVEL (a equipe escreve, todos os workspaces leem).
 *
 * UX: §2.5 `?` no título; §2.6 "nenhum artigo aberto" explica o próximo passo.
 */
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { EmptyState } from '@hm/ui';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
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
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/help"
        title="Central de Ajuda"
        description="Escrito aqui, lido por todos os workspaces. Publicar não exige deploy."
        help={
          <p>
            O preview usa o mesmo render sanitizado do leitor: o que aparece no preview é o que o
            cliente vê. A chave de âncora liga o artigo à ajuda contextual de uma tela do app.
          </p>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
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
          <section
            aria-label="Editor"
            className="flex min-w-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border-2 px-6 py-16"
          >
            <EmptyState
              icon={FileText}
              title="Nenhum artigo aberto"
              description="Escolha um artigo na lista para editar, ou crie um novo."
            />
          </section>
        )}
      </div>
    </div>
  );
}
