'use client';

/**
 * Leitura de um artigo da Central de Ajuda (F38-S05; DS 3.0 na F72-S08). Render
 * Markdown SANITIZADO (mesmo primitive @hm/ui do preview do CMS). Feedback "isso
 * ajudou?" (S03). Estados carregando, não encontrado e erro (este com "tentar de novo":
 * falha de rede não é "artigo não existe").
 *
 * Leitura longa: corpo em 17px, entrelinha 1,75 e medida de ~68 caracteres.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, FileQuestion, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button, Markdown } from '@hm/ui';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { HelpEyebrow, backLinkClass } from './HelpEyebrow';
import { useHelpArticle, useSubmitFeedback } from './queries';

/**
 * Ajustes de leitura sobre a prose do `Markdown` (o `cn` dele resolve o conflito com
 * `tailwind-merge`). Tamanhos em valor arbitrário de propósito: um token de tamanho
 * customizado (`text-body`) seria lido pelo merge como cor e apagaria a cor do texto.
 */
const READING =
  'max-w-[68ch] text-[1.0625rem] leading-[1.75] [&>:first-child]:mt-0 [&_p]:my-4 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-[1.3125rem] [&_h2]:tracking-[-0.025em] [&_h3]:mt-8 [&_h3]:text-[1.125rem] [&_a]:text-brand-text [&_a]:font-semibold [&_a]:underline [&_ul>li]:mt-2 [&_ol>li]:mt-2';

export function ArticleView({ slug }: { slug: string }) {
  const { data, isLoading, isError, error, refetch } = useHelpArticle(slug);
  const article = data?.article;
  const notFound = isError && (error as { status?: number } | null)?.status === 404;

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <span className="sr-only">Carregando artigo</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </div>
    );
  }

  if (isError && !notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          error={error}
          title="Não foi possível abrir o artigo"
          reason="A Central de Ajuda não respondeu agora."
          whatToDo="Tente de novo em instantes."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          }
        />
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4">
        <EmptyState
          icon={FileQuestion}
          title="Artigo não encontrado"
          description="Este artigo não existe ou ainda não foi publicado."
        />
        <Link href="/help" className={backLinkClass}>
          <ArrowLeft className="size-4" aria-hidden /> Voltar à Central de Ajuda
        </Link>
      </div>
    );
  }

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <Link href="/help" className={backLinkClass}>
        <ArrowLeft className="size-4" aria-hidden /> Voltar à Central de Ajuda
      </Link>

      <header className="flex flex-col gap-3 border-b border-border pb-8">
        <HelpEyebrow>Central de Ajuda · Artigo</HelpEyebrow>
        <h1 className="font-head text-h3 text-balance text-text md:text-h2">{article.title}</h1>
        {article.excerpt && (
          <p className="max-w-[60ch] font-body text-lg leading-[1.6] text-text-mid">{article.excerpt}</p>
        )}
      </header>

      <Markdown className={READING}>{article.bodyMd}</Markdown>

      <Feedback articleId={article.id} />
    </article>
  );
}

function Feedback({ articleId }: { articleId: string }) {
  const submit = useSubmitFeedback(articleId);
  const [done, setDone] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(null);

  function send(helpful: boolean): void {
    setChoice(helpful);
    submit.mutate({ helpful }, { onSuccess: () => setDone(true) });
  }

  if (done) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-5 py-4"
      >
        <Check className="size-5 text-success" aria-hidden />
        <p className="font-body text-sm text-text-mid">Obrigado pelo seu feedback!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body font-bold text-text">Este artigo ajudou?</p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ThumbsUp className="size-4" aria-hidden />}
          loading={submit.isPending && choice === true}
          disabled={submit.isPending}
          onClick={() => send(true)}
        >
          Sim
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ThumbsDown className="size-4" aria-hidden />}
          loading={submit.isPending && choice === false}
          disabled={submit.isPending}
          onClick={() => send(false)}
        >
          Não
        </Button>
      </div>
    </div>
  );
}
