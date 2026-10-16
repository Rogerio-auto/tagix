'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, SearchX, Users } from 'lucide-react';
import {
  AnchoredHelpHint,
  Avatar,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  StatusPill,
  type DataTableColumn,
} from '@hm/ui';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import {
  ResponsiveTable,
  type ActiveFilterChip,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDate, formatNumber } from '@/shared/lib/locale';
import { useContacts, useTags } from './queries';
import { ContactDetailDrawer } from './ContactDetailDrawer';
import { ContactFormModal } from './ContactFormModal';
import { controlClass } from './styles';
import type { Contact, ContactFilters } from './types';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/** Data compacta de lista (uma linha, mesmo padrão de campanhas/flows/agentes). */
const LIST_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/**
 * Rótulo legível da origem. A origem é texto livre (o form permite digitar), então só
 * os valores conhecidos do sistema são traduzidos; o resto aparece como foi escrito.
 */
const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  site: 'Site',
  manual: 'Manual',
  api: 'API',
  import: 'Importação',
  csv: 'Importação',
  lead_ads: 'Lead Ads',
};

function sourceLabel(source: string | null): string {
  if (!source) return '—';
  return SOURCE_LABEL[source.toLowerCase()] ?? source;
}

function OptInPill({ contact }: { contact: Contact }): React.JSX.Element {
  return contact.marketingOptIn ? (
    <StatusPill tone="success" size="sm">
      Opt-in
    </StatusPill>
  ) : (
    <StatusPill tone="neutral" size="sm">
      Sem opt-in
    </StatusPill>
  );
}

/**
 * Página /contacts (CRM) no DS 3.0 (F72-S07).
 *
 * Desktop (`md+`): barra de busca/filtros + `DataTable` operacional (cabeçalho mono,
 * linha clicável abre o Drawer, linha aberta marcada). Mobile: o primitivo
 * `ResponsiveTable` (cards + filtros em bottom-sheet), contrato do e2e mobile-table.
 *
 * UX: §2.1 clique na linha abre o detalhe; §2.3 detalhe em Drawer; §2.5 `?` no título;
 * §2.6 vazio acionável (primeiro uso vs. filtro sem resultado); §2.7 skeleton no
 * formato da tabela; §2.10 `/` foca a busca, setas navegam entre linhas; §2.11 erro
 * em 3 partes com "Tentar de novo". Só leitura: "Novo contato" fica `aria-disabled`.
 */
export function ContactsPage(): React.JSX.Element {
  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'contact.edit') : false;
  const { isMobile } = useBreakpoint();
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tagId, setTagId] = useState('');
  const [optIn, setOptIn] = useState<'' | 'true' | 'false'>('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Contact | null>(null);

  const filters: ContactFilters = {
    q: debounced || undefined,
    tagId: tagId || undefined,
    optIn: optIn || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
  const listQuery = useContacts(filters);
  const tagsQuery = useTags();
  const tags = tagsQuery.data?.tags ?? [];

  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  // `/` foca a busca (UX §2.10), salvo quando o foco já está num campo de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onSearch = (value: string): void => {
    setSearch(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebounced(value.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  };

  const data = listQuery.data;
  const contacts = data?.contacts ?? [];
  const isFiltering = debounced !== '' || tagId !== '' || optIn !== '';

  const openEdit = (id: string): void => {
    const c = contacts.find((x) => x.id === id) ?? null;
    setEditTarget(c);
    setFormOpen(true);
  };

  const openCreate = (): void => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const clearAllFilters = (): void => {
    setTagId('');
    setOptIn('');
    setPage(1);
  };

  const clearEverything = (): void => {
    clearAllFilters();
    setSearch('');
    setDebounced('');
  };

  const createButton = (label: string): React.JSX.Element => (
    <ReadOnlyGuard>
      <Button variant="primary" leftIcon={<Plus className="size-4" aria-hidden />} onClick={openCreate}>
        {label}
      </Button>
    </ReadOnlyGuard>
  );

  // ── Desktop: colunas do DataTable ─────────────────────────────────────────
  const tableColumns = useMemo<DataTableColumn<Contact>[]>(
    () => [
      {
        id: 'name',
        header: 'Nome',
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="shrink-0">
              <Avatar name={c.displayName} src={c.avatarUrl} size="sm" shape="circle" />
            </span>
            <span className="truncate font-bold text-text">{c.displayName ?? 'Sem nome'}</span>
          </span>
        ),
      },
      {
        id: 'contact',
        header: 'Contato',
        cell: (c) =>
          c.phone ? (
            <span className="font-mono text-sm tabular-nums">{c.phone}</span>
          ) : (
            <span className="truncate">{c.email ?? '—'}</span>
          ),
      },
      { id: 'source', header: 'Origem', cell: (c) => sourceLabel(c.source) },
      { id: 'optIn', header: 'Marketing', width: '9rem', cell: (c) => <OptInPill contact={c} /> },
      {
        id: 'createdAt',
        header: 'Criado em',
        numeric: true,
        width: '8rem',
        cell: (c) => (
          <span className="whitespace-nowrap text-text-mid">{formatDate(c.createdAt, LIST_DATE)}</span>
        ),
      },
    ],
    [],
  );

  // ── Mobile: colunas do ResponsiveTable (cards) ────────────────────────────
  const cardColumns = useMemo<ResponsiveColumn<Contact>[]>(
    () => [
      {
        id: 'avatar',
        card: 'avatar',
        cell: (c) => (
          <span aria-hidden>
            <Avatar name={c.displayName} src={c.avatarUrl} size="md" shape="circle" />
          </span>
        ),
      },
      { id: 'name', card: 'primary', cell: (c) => c.displayName ?? 'Sem nome' },
      {
        id: 'contact',
        card: 'secondary',
        cell: (c) =>
          c.phone ? <span className="font-mono tabular-nums">{c.phone}</span> : (c.email ?? '—'),
      },
      { id: 'source', card: 'meta', cell: (c) => sourceLabel(c.source) },
      { id: 'optIn', card: 'badge', cell: (c) => <OptInPill contact={c} /> },
    ],
    [],
  );

  // Chips de filtro ativo (mobile).
  const activeFilters = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];
    if (tagId) {
      const tag = tags.find((t) => t.id === tagId);
      chips.push({
        id: 'tag',
        label: `Tag: ${tag?.name ?? tagId}`,
        onClear: () => {
          setTagId('');
          setPage(1);
        },
      });
    }
    if (optIn) {
      chips.push({
        id: 'optIn',
        label: optIn === 'true' ? 'Com opt-in' : 'Sem opt-in',
        onClear: () => {
          setOptIn('');
          setPage(1);
        },
      });
    }
    return chips;
  }, [tagId, optIn, tags]);

  const searchField = (
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-text-low"
        aria-hidden
      />
      <Input
        ref={searchRef}
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && search) {
            e.preventDefault();
            onSearch('');
          }
        }}
        placeholder="Buscar por nome, telefone ou e-mail"
        aria-label="Buscar contatos"
        aria-keyshortcuts="/"
        className="pl-9"
      />
    </div>
  );

  const filterControls = (
    <>
      {tags.length > 0 && (
        <select
          value={tagId}
          onChange={(e) => {
            setTagId(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por tag"
          className={controlClass}
        >
          <option value="">Todas as tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={optIn}
        onChange={(e) => {
          setOptIn(e.target.value as '' | 'true' | 'false');
          setPage(1);
        }}
        aria-label="Filtrar por opt-in"
        className={controlClass}
      >
        <option value="">Opt-in: todos</option>
        <option value="true">Com opt-in</option>
        <option value="false">Sem opt-in</option>
      </select>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as 'recent' | 'name')}
        aria-label="Ordenar"
        className={controlClass}
      >
        <option value="recent">Mais recentes</option>
        <option value="name">Nome (A-Z)</option>
      </select>
    </>
  );

  const pagination =
    data && data.totalPages > 1 ? (
      <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs tabular-nums text-text-low">
          Página {formatNumber(data.page)} de {formatNumber(data.totalPages)}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1 || listQuery.isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= data.totalPages || listQuery.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </nav>
    ) : null;

  const errorCopy = {
    title: 'Não foi possível carregar os contatos',
    reason: 'A lista de contatos não respondeu.',
    whatToDo: 'Verifique a conexão e tente novamente.',
  };
  const retry = (
    <Button variant="secondary" size="sm" onClick={() => void listQuery.refetch()}>
      Tentar de novo
    </Button>
  );

  const count = data?.total;
  const description =
    count === undefined ? (
      'Todas as pessoas que já falaram com a empresa.'
    ) : (
      <span>
        <span className="font-mono tabular-nums text-text-mid">{formatNumber(count)}</span>{' '}
        {count === 1 ? 'contato' : 'contatos'}
        {isFiltering ? ' com estes filtros' : ' no workspace'}
      </span>
    );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Contatos"
        description={description}
        helpSlot={<AnchoredHelpHint anchorKey="contacts.list" />}
        actions={canEdit ? createButton('Novo contato') : undefined}
      />

      {isMobile ? (
        <ResponsiveTable<Contact>
          ariaLabel="Contatos"
          rows={contacts}
          columns={cardColumns}
          getRowId={(c) => c.id}
          onRowClick={(c) => setSelectedId(c.id)}
          rowLabel={(c) => `Abrir contato ${c.displayName ?? 'sem nome'}`}
          searchSlot={searchField}
          filters={filterControls}
          filtersTitle="Filtrar contatos"
          activeFilters={activeFilters}
          onClearFilters={activeFilters.length > 0 ? clearAllFilters : undefined}
          isLoading={listQuery.isLoading}
          isError={listQuery.isError}
          error={{ ...errorCopy, action: retry }}
          empty={{
            icon: isFiltering ? SearchX : Users,
            title: isFiltering ? 'Nenhum contato com estes filtros' : 'Nenhum contato ainda',
            description: isFiltering
              ? 'Ajuste a busca ou limpe os filtros para ver mais resultados.'
              : 'Os contatos chegam sozinhos pelas conversas. Você também pode criar um à mão.',
            action: isFiltering ? undefined : canEdit ? createButton('Criar contato') : undefined,
          }}
          footer={pagination}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-64 flex-1">{searchField}</div>
            {filterControls}
          </div>

          <DataTable<Contact>
            caption="Contatos"
            columns={tableColumns}
            rows={contacts}
            getRowId={(c) => c.id}
            loading={listQuery.isLoading}
            loadingRows={8}
            onRowClick={(c) => setSelectedId(c.id)}
            getRowLabel={(c) => `Abrir contato ${c.displayName ?? 'sem nome'}`}
            getRowState={(c) => (c.id === selectedId ? 'selected' : undefined)}
            error={
              listQuery.isError ? <ErrorState {...errorCopy} action={retry} /> : undefined
            }
            empty={
              isFiltering ? (
                <EmptyState
                  variant="no-results"
                  icon={SearchX}
                  title="Nenhum contato com estes filtros"
                  description="Ajuste a busca ou limpe os filtros para ver mais resultados."
                  secondaryAction={
                    <Button variant="ghost" size="sm" onClick={clearEverything}>
                      Limpar filtros
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title="Nenhum contato ainda"
                  description="Os contatos chegam sozinhos pelas conversas. Você também pode criar um à mão."
                  action={canEdit ? createButton('Criar contato') : undefined}
                />
              )
            }
          />
          {pagination}
        </div>
      )}

      <ContactDetailDrawer
        contactId={selectedId}
        role={role}
        onClose={() => setSelectedId(null)}
        onEdit={openEdit}
      />
      <ContactFormModal open={formOpen} onClose={() => setFormOpen(false)} contact={editTarget} />
    </div>
  );
}
