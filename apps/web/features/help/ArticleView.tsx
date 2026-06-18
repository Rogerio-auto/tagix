'use client';

/**
 * Leitura de um artigo da Central de Ajuda (F38-S05). Render Markdown SANITIZADO
 * (mesmo primitive @hm/ui do preview do CMS). Feedback "isso ajudou?" (S03).
 * Estados loading/notFound/error; volta para a home.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Markdown } from '@hm/ui';
import { EmptyState } from '@/shared/components/feedback';
import { FileQuestion } from 'lucide-react';
import { useHelpArticle, useSubmitFeedback } from './queries';

export function ArticleView({ slug }: { slug: string }) {
  const { data, isLoading, isError, error } = useHelpArticle(slug);
  const article = data?.article;
  const notFound = isError && (error as { status?: number } | null)?.status === 404;

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="mt-6 flex flex-col gap-3">
          <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState
          icon={FileQuestion}
          title="Artigo nao encontrado"
          description="Este artigo nao existe ou ainda nao foi publicado."
        />
        <div className="mt-4 text-center">
          <Link
            href="/help"
            className="font-head text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:shadow-glow-md"
          >
            Voltar a Central de Ajuda
          </Link>
        </div>
      </div>
    );
  }

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1.5 font-head text-sm text-text-mid outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
      >
        <ArrowLeft className="size-4" aria-hidden /> Voltar a Central de Ajuda
      </Link>

      <header className="flex flex-col gap-2 border-b border-border-2 pb-5">
        <h1 className="font-head text-3xl font-semibold text-text">{article.title}</h1>
        {article.excerpt && <p className="font-body text-lg text-text-mid">{article.excerpt}</p>}
      </header>

      <Markdown>{article.bodyMd}</Markdown>

      <Feedback articleId={article.id} />
    </article>
  );
}

function Feedback({ articleId }: { articleId: string }) {
  const submit = useSubmitFeedback(articleId);
  const [done, setDone] = useState(false);

  function send(helpful: boolean): void {
    submit.mutate({ helpful }, { onSuccess: () => setDone(true) });
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border-2 bg-surface-2 px-5 py-4">
        <Check className="size-5 text-brand" aria-hidden />
        <p className="font-body text-sm text-text-mid">Obrigado pelo seu feedback!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-2 bg-surface-2 px-5 py-4">
      <p className="font-head text-sm font-medium text-text">Este artigo ajudou?</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => send(true)}
          disabled={submit.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-head text-sm text-text-mid outline-none transition-colors hover:border-border-2 hover:text-text focus-visible:shadow-glow-md disabled:opacity-50"
        >
          <ThumbsUp className="size-4" aria-hidden /> Sim
        </button>
        <button
          type="button"
          onClick={() => send(false)}
          disabled={submit.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-head text-sm text-text-mid outline-none transition-colors hover:border-border-2 hover:text-text focus-visible:shadow-glow-md disabled:opacity-50"
        >
          <ThumbsDown className="size-4" aria-hidden /> Nao
        </button>
      </div>
    </div>
  );
}
