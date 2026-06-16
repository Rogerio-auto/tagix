'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import { Button } from '@hm/ui';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import {
  ResponsiveTable,
  type ActiveFilterChip,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import { useContacts, useTags } from './queries';
import { ContactDetailDrawer } from './ContactDetailDrawer';
import { ContactFormModal } from './ContactFormModal';
import type { Contact, ContactFilters } from './types';

const PAGE_SIZE = 25;

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function Avatar({ contact }: { contact: Contact }): React.JSX.Element {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-text-mid">
      {initials(contact.displayName)}
    </span>
  );
}

function OptInBadge({ contact }: { contact: Contact }): React.JSX.Element | null {
  if (!contact.marketingOptIn) return null;
  return (
    <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">opt-in</span>
  );
}

const selectClass =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md';

/** Página /contacts (CRM): lista paginada + busca/filtros + drawer de detalhe.
 *  Adota o primitivo `ResponsiveTable`: tabela densa em md+, cards em mobile. */
export function ContactsPage(): React.JSX.Element {
  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'contact.edit') : false;

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

  // Debounce simples da busca (300ms) — reseta a página.
  const onSearch = (value: string) => {
    setSearch(value);
    window.clearTimeout((onSearch as unknown as { t?: number }).t);
    (onSearch as unknown as { t?: number }).t = window.setTimeout(() => {
      setDebounced(value.trim());
      setPage(1);
    }, 300);
  };

  const data = listQuery.data;
  const contacts = data?.contacts ?? [];

  const openEdit = (id: string) => {
    const c = contacts.find((x) => x.id === id) ?? null;
    setEditTarget(c);
    setFormOpen(true);
  };

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const clearAllFilters = () => {
    setTagId('');
    setOptIn('');
    setPage(1);
  };

  // Colunas: dirigem tanto a tabela (desktop) quanto os cards (mobile).
  const columns = useMemo<ResponsiveColumn<Contact>[]>(
    () => [
      {
        id: 'avatar',
        card: 'avatar',
        width: '1px',
        cell: (c) => <Avatar contact={c} />,
      },
      {
        id: 'name',
        header: 'Nome',
        card: 'primary',
        cell: (c) => (
          <span className="font-medium text-text">{c.displayName ?? 'Sem nome'}</span>
        ),
      },
      {
        id: 'contact',
        header: 'Contato',
        card: 'secondary',
        cell: (c) => <span className="text-text-low">{c.phone ?? c.email ?? '—'}</span>,
      },
      {
        id: 'source',
        header: 'Origem',
        card: 'meta',
        cell: (c) => <span className="text-text-low">{c.source ?? '—'}</span>,
      },
      {
        id: 'optIn',
        header: 'Marketing',
        card: 'badge',
        align: 'right',
        width: '1px',
        cell: (c) => <OptInBadge contact={c} />,
      },
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

  const searchSlot = (
    <div className="relative w-full">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low" />
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Buscar por nome, telefone ou e-mail"
        aria-label="Buscar contatos"
        className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none focus-visible:shadow-glow-md"
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
          className={selectClass}
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
        className={selectClass}
      >
        <option value="">Opt-in: todos</option>
        <option value="true">Com opt-in</option>
        <option value="false">Sem opt-in</option>
      </select>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as 'recent' | 'name')}
        aria-label="Ordenar"
        className={selectClass}
      >
        <option value="recent">Mais recentes</option>
        <option value="name">Nome (A-Z)</option>
      </select>
    </>
  );

  const pagination =
    data && data.totalPages > 1 ? (
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-low">
          Página {data.page} de {data.totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </Button>
          <Button variant="ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-head text-lg font-semibold text-text">Contatos</h1>
          <p className="text-sm text-text-low">
            {data ? `${data.total} contato${data.total === 1 ? '' : 's'}` : 'Carregando…'}
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="size-4" />
            Novo contato
          </Button>
        )}
      </header>

      <ResponsiveTable<Contact>
        ariaLabel="Contatos"
        rows={contacts}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={(c) => setSelectedId(c.id)}
        rowLabel={(c) => `Abrir contato ${c.displayName ?? 'sem nome'}`}
        searchSlot={searchSlot}
        filters={filterControls}
        filtersTitle="Filtrar contatos"
        activeFilters={activeFilters}
        onClearFilters={activeFilters.length > 0 ? clearAllFilters : undefined}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={{
          title: 'Não foi possível carregar os contatos',
          reason: 'A lista de contatos não respondeu.',
          whatToDo: 'Verifique a conexão e tente novamente.',
        }}
        empty={{
          icon: Users,
          title: 'Nenhum contato encontrado',
          description: canEdit
            ? 'Ajuste os filtros ou crie o primeiro contato do workspace.'
            : 'Ajuste os filtros para ver mais resultados.',
          action: canEdit ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus className="size-4" />
              Criar contato
            </Button>
          ) : undefined,
        }}
        footer={pagination}
      />

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
