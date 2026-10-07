'use client';

/**
 * Catálogo de modelos aprovados em Drawer (F58-S09 · UX §2.3).
 *
 * Drawer e não modal: a pessoa escolhe olhando para a mensagem que está
 * montando. A lista mostra o que a mensagem DIZ — nome legível, começo do texto,
 * se tem imagem, botões e espaços para preencher —, porque ninguém lembra do
 * identificador `promo_marco_v2` que alguém cadastrou na Meta.
 *
 * Teclado (UX §2.10): `/` vai para a busca, setas percorrem a lista, Enter
 * escolhe, Esc fecha (o Drawer cuida do Esc).
 */
import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, ImageIcon, ListChecks, MousePointerClick, Search, Video } from 'lucide-react';
import { Button, Drawer, Input } from '@hm/ui';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { cn } from '@/shared/lib/cn';
import { categoryLabel, languageLabel } from '@/features/channels/message-templates/format';
import {
  EMPTY_FILTERS,
  facetValues,
  filterTemplates,
  friendlyTemplateName,
  parseTemplate,
  variableSlots,
  type CatalogFilters,
  type TemplateOption,
} from './model';

export interface TemplatePickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly channelId: string;
  readonly templates: readonly TemplateOption[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
  readonly retrying: boolean;
  readonly truncated: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (template: TemplateOption) => void;
}

interface Summary {
  readonly snippet: string;
  readonly media: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null;
  readonly buttons: number;
  readonly variables: number;
}

function summarize(template: TemplateOption): Summary {
  const parsed = parseTemplate(template.components);
  if (!parsed)
    return {
      snippet: 'Conteúdo não reconhecido. Sincronize os modelos.',
      media: null,
      buttons: 0,
      variables: 0,
    };
  const format = parsed.header?.format;
  return {
    snippet: parsed.body.replace(/\s+/gu, ' ').trim(),
    media: format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT' ? format : null,
    buttons: parsed.buttons.length,
    variables: variableSlots(parsed).length,
  };
}

const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText } as const;
const MEDIA_LABEL = { IMAGE: 'Com imagem', VIDEO: 'Com vídeo', DOCUMENT: 'Com documento' } as const;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function TemplatePicker({
  open,
  onClose,
  channelId,
  templates,
  loading,
  error,
  onRetry,
  retrying,
  truncated,
  selectedId,
  onSelect,
}: TemplatePickerProps): React.JSX.Element {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const categories = useMemo(() => facetValues(templates, 'category'), [templates]);
  const languages = useMemo(() => facetValues(templates, 'language'), [templates]);
  const visible = useMemo(() => filterTemplates(templates, filters), [templates, filters]);
  const filtering = Boolean(filters.search || filters.category || filters.language);

  // Busca focada ao abrir: quem abre o catálogo quase sempre já sabe o que procura.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  // `/` em qualquer ponto do drawer volta para a busca.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function focusOption(offset: number): void {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-template-option]') ?? [],
    );
    if (options.length === 0) return;
    const current = options.findIndex((el) => el === document.activeElement);
    const next = current < 0 ? (offset > 0 ? 0 : options.length - 1) : current + offset;
    options[Math.min(options.length - 1, Math.max(0, next))]?.focus();
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(-1);
    }
  }

  const centralHref = `/settings/channels/${encodeURIComponent(channelId)}/message-templates`;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <ul aria-busy aria-label="Carregando modelos" className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/5" />
          </li>
        ))}
      </ul>
    );
  } else if (error) {
    body = (
      <ErrorState
        title="Não conseguimos carregar os modelos"
        reason={error.message}
        whatToDo="Tente de novo. Se continuar, confira a conexão do número em Canais."
        action={
          <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
            Tentar de novo
          </Button>
        }
      />
    );
  } else if (templates.length === 0) {
    body = (
      <EmptyState
        icon={ListChecks}
        title="Nenhum modelo aprovado ainda"
        description="Campanhas no WhatsApp oficial só saem com modelos aprovados pela Meta. Crie um ou sincronize os que já existem."
        action={
          <Link
            href={centralHref}
            className="inline-flex h-10 items-center rounded-md bg-surface-2 px-4 text-sm font-medium text-text outline-none hover:bg-surface-3 focus-visible:shadow-glow-md"
          >
            Abrir modelos do WhatsApp
          </Link>
        }
      />
    );
  } else if (visible.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-sm text-text">Nenhum modelo com esses filtros.</p>
        <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          Limpar filtros
        </Button>
      </div>
    );
  } else {
    body = (
      <ul
        ref={listRef}
        aria-label="Modelos aprovados"
        onKeyDown={onListKeyDown}
        className="flex flex-col gap-2"
      >
        {visible.map((template) => {
          const summary = summarize(template);
          const selected = template.id === selectedId;
          const MediaIcon = summary.media ? MEDIA_ICON[summary.media] : null;
          return (
            <li key={template.id}>
              <button
                type="button"
                data-template-option
                aria-pressed={selected}
                onClick={() => onSelect(template)}
                className={cn(
                  'flex w-full flex-col gap-1.5 rounded-md border p-3 text-left outline-none transition-colors duration-150',
                  'focus-visible:shadow-glow-md motion-reduce:transition-none',
                  selected
                    ? 'border-border-brand bg-surface-2'
                    : 'border-border bg-surface hover:border-border-2 hover:bg-surface-2',
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-text">
                    {friendlyTemplateName(template.name)}
                  </span>
                  {selected ? (
                    <span className="shrink-0 text-xs font-medium text-success">Em uso</span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-xs leading-relaxed text-text-mid">
                  {summary.snippet}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-low">
                  <span>{categoryLabel(template.category)}</span>
                  <span>{languageLabel(template.language)}</span>
                  {MediaIcon && summary.media ? (
                    <span className="inline-flex items-center gap-1">
                      <MediaIcon className="size-3" aria-hidden />
                      {MEDIA_LABEL[summary.media]}
                    </span>
                  ) : null}
                  {summary.buttons > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick className="size-3" aria-hidden />
                      {plural(summary.buttons, 'botão', 'botões')}
                    </span>
                  ) : null}
                  <span>
                    {summary.variables === 0
                      ? 'Sem campos para preencher'
                      : plural(summary.variables, 'campo para preencher', 'campos para preencher')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Escolher modelo de mensagem"
      description="Só aparecem modelos aprovados pela Meta para este número."
      className="max-w-lg"
      footer={
        <p className="text-xs text-text-low">
          Não achou?{' '}
          <Link
            href={centralHref}
            className="rounded-xs font-medium text-text underline-offset-4 outline-none hover:underline focus-visible:shadow-glow-md"
          >
            Crie ou sincronize na central de modelos
          </Link>
          .
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {templates.length > 0 && !loading && !error ? (
          <div className="flex flex-col gap-3">
            <label className="relative block">
              <span className="sr-only">Buscar modelo</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-low"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    focusOption(1);
                  }
                }}
                placeholder="Buscar pelo nome ou pelo texto  ( / )"
                className="pl-9"
              />
            </label>

            {categories.length > 1 ? (
              <div role="group" aria-label="Categoria" className="flex flex-wrap gap-1.5">
                {['', ...categories].map((category) => {
                  const active = filters.category === category;
                  return (
                    <button
                      key={category || 'all'}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilters((f) => ({ ...f, category }))}
                      className={cn(
                        'rounded-pill border px-3 py-1 text-xs outline-none transition-colors duration-150 focus-visible:shadow-glow-md motion-reduce:transition-none',
                        active
                          ? 'border-border-2 bg-surface-3 text-text'
                          : 'border-border text-text-mid hover:bg-surface-2',
                      )}
                    >
                      {category ? categoryLabel(category) : 'Todas'}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {languages.length > 1 ? (
              <label className="flex items-center gap-2 text-xs text-text-mid">
                Idioma
                <select
                  value={filters.language}
                  onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none focus-visible:shadow-glow-md"
                >
                  <option value="">Todos os idiomas</option>
                  {languages.map((language) => (
                    <option key={language} value={language}>
                      {languageLabel(language)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <p aria-live="polite" className="text-xs text-text-low">
              {filtering
                ? `${plural(visible.length, 'modelo encontrado', 'modelos encontrados')} de ${templates.length}`
                : plural(templates.length, 'modelo aprovado', 'modelos aprovados')}
            </p>
            {truncated ? (
              <p className="text-xs text-warn">
                Este número tem modelos demais para listar de uma vez. Use a busca para achar o seu.
              </p>
            ) : null}
          </div>
        ) : null}
        {body}
      </div>
    </Drawer>
  );
}
