'use client';

/**
 * Editor de artigo do CMS de Ajuda (F38-S04). Campos + corpo Markdown com
 * preview AO VIVO usando o MESMO render sanitizado do leitor (@hm/ui Markdown),
 * garantindo preview === publicado e ZERO divergencia de XSS (alvo do S15).
 * Workflow draft -> published com publish/unpublish.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, FileText, Save, Send, Trash2, Undo2 } from 'lucide-react';
import type { HelpArticleDTO, HelpCategoryDTO } from '@hm/shared';
import { Button, Markdown } from '@hm/ui';
import { ErrorState } from '@/shared/components/feedback';
import {
  useCreateArticle,
  useDeleteArticle,
  usePublishArticle,
  useUpdateArticle,
} from './queries';

interface Draft {
  categoryId: string;
  slug: string;
  title: string;
  excerpt: string;
  anchorKey: string;
  bodyMd: string;
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

function toDraft(a: HelpArticleDTO | null, fallbackCategory: string): Draft {
  return {
    categoryId: a?.categoryId ?? fallbackCategory,
    slug: a?.slug ?? '',
    title: a?.title ?? '',
    excerpt: a?.excerpt ?? '',
    anchorKey: a?.anchorKey ?? '',
    bodyMd: a?.bodyMd ?? '',
  };
}

interface Props {
  article: HelpArticleDTO | null;
  isNew: boolean;
  categories: HelpCategoryDTO[];
  defaultCategoryId: string;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}

const labelCls = 'mb-1 block font-head text-xs font-semibold uppercase tracking-wide text-text-low';
const fieldCls =
  'w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-body text-sm text-text outline-none transition-colors placeholder:text-text-low focus-visible:border-border-2 focus-visible:shadow-glow-md';

export function ArticleEditor({
  article,
  isNew,
  categories,
  defaultCategoryId,
  onSaved,
  onDeleted,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(article, defaultCategoryId));
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [touchedSlug, setTouchedSlug] = useState(!isNew);

  const create = useCreateArticle();
  const update = useUpdateArticle();
  const publish = usePublishArticle();
  const remove = useDeleteArticle();

  useEffect(() => {
    setDraft(toDraft(article, defaultCategoryId));
    setTouchedSlug(!isNew);
  }, [article, isNew, defaultCategoryId]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const valid =
    draft.title.trim() !== '' &&
    draft.slug.trim() !== '' &&
    draft.bodyMd.trim() !== '' &&
    draft.categoryId !== '';

  async function save(): Promise<void> {
    if (!valid) return;
    const payload = {
      categoryId: draft.categoryId,
      slug: draft.slug.trim(),
      title: draft.title.trim(),
      excerpt: draft.excerpt.trim() === '' ? null : draft.excerpt.trim(),
      anchorKey: draft.anchorKey.trim() === '' ? null : draft.anchorKey.trim(),
      bodyMd: draft.bodyMd,
    };
    if (isNew) {
      const created = await create.mutateAsync(payload);
      onSaved(created.article.id);
    } else if (article) {
      const updated = await update.mutateAsync({ id: article.id, patch: payload });
      onSaved(updated.article.id);
    }
  }

  const isPublished = article?.status === 'published';
  const saving = create.isPending || update.isPending;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-text-mid" aria-hidden />
          <h2 className="font-head text-lg font-semibold text-text">
            {isNew ? 'Novo artigo' : 'Editar artigo'}
          </h2>
          {!isNew && article && (
            <span
              className={
                isPublished
                  ? 'rounded-pill bg-brand/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand'
                  : 'rounded-pill bg-surface-3 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-low'
              }
            >
              {isPublished ? 'Publicado' : 'Rascunho'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && article && (
            <Button
              variant={isPublished ? 'outline' : 'secondary'}
              size="sm"
              loading={publish.isPending}
              onClick={() => void publish.mutateAsync({ id: article.id, publish: !isPublished })}
            >
              {isPublished ? (
                <Undo2 className="size-4" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              {isPublished ? 'Despublicar' : 'Publicar'}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!valid}
            onClick={() => void save()}
          >
            <Save className="size-4" aria-hidden /> Salvar
          </Button>
          {!isNew && article && (
            <Button
              variant="ghost"
              size="sm"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm('Excluir este artigo? A acao nao pode ser desfeita.')) {
                  void remove.mutateAsync(article.id).then(onDeleted);
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden /> Excluir
            </Button>
          )}
        </div>
      </header>

      {(create.isError || update.isError) && (
        <ErrorState
          title="Nao foi possivel salvar"
          reason="Verifique o slug (kebab-case, unico) e os campos obrigatorios."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="art-title">
            Titulo
          </label>
          <input
            id="art-title"
            value={draft.title}
            onChange={(e) => {
              set('title', e.target.value);
              if (!touchedSlug) set('slug', slugify(e.target.value));
            }}
            placeholder="Como criar um agente"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="art-slug">
            Slug
          </label>
          <input
            id="art-slug"
            value={draft.slug}
            onChange={(e) => {
              setTouchedSlug(true);
              set('slug', e.target.value);
            }}
            placeholder="como-criar-um-agente"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="art-cat">
            Categoria
          </label>
          <select
            id="art-cat"
            value={draft.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
            className={fieldCls}
          >
            <option value="">Selecione...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="art-anchor">
            Chave de ancora (help contextual, opcional)
          </label>
          <input
            id="art-anchor"
            value={draft.anchorKey}
            onChange={(e) => set('anchorKey', e.target.value)}
            placeholder="agents.create"
            className={fieldCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="art-excerpt">
            Resumo (opcional)
          </label>
          <input
            id="art-excerpt"
            value={draft.excerpt}
            onChange={(e) => set('excerpt', e.target.value)}
            placeholder="Uma linha que aparece na busca e na lista."
            className={fieldCls}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-1 border-b border-border-2">
          <TabButton
            active={tab === 'write'}
            onClick={() => setTab('write')}
            icon={<FileText className="size-4" aria-hidden />}
          >
            Markdown
          </TabButton>
          <TabButton
            active={tab === 'preview'}
            onClick={() => setTab('preview')}
            icon={<Eye className="size-4" aria-hidden />}
          >
            Preview
          </TabButton>
        </div>

        {tab === 'write' ? (
          <textarea
            value={draft.bodyMd}
            onChange={(e) => set('bodyMd', e.target.value)}
            aria-label="Corpo do artigo em Markdown"
            placeholder="Escreva o conteudo em Markdown. Titulos, listas, links, codigo e blocos de codigo sao suportados."
            className={fieldCls + ' min-h-[320px] flex-1 resize-y font-price leading-relaxed'}
          />
        ) : (
          <div className="min-h-[320px] flex-1 overflow-y-auto rounded-md border border-border-2 bg-surface p-5">
            {draft.bodyMd.trim() === '' ? (
              <p className="text-sm text-text-low">Nada para pre-visualizar ainda.</p>
            ) : (
              <Markdown>{draft.bodyMd}</Markdown>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'inline-flex items-center gap-1.5 border-b-2 border-brand px-3 py-2 font-head text-sm font-medium text-text outline-none transition-colors focus-visible:shadow-glow-md'
          : 'inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 font-head text-sm font-medium text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md'
      }
    >
      {icon}
      {children}
    </button>
  );
}
