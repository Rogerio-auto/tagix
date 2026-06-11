'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@hm/ui';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
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

/** Página /contacts (CRM): lista paginada + busca/filtros + drawer de detalhe. */
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
          <Button
            variant="primary"
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            Novo contato
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou e-mail"
            aria-label="Buscar contatos"
            className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none focus-visible:shadow-glow-md"
          />
        </div>
        {tags.length > 0 && (
          <select
            value={tagId}
            onChange={(e) => {
              setTagId(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrar por tag"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
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
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          <option value="">Opt-in: todos</option>
          <option value="true">Com opt-in</option>
          <option value="false">Sem opt-in</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'recent' | 'name')}
          aria-label="Ordenar"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          <option value="recent">Mais recentes</option>
          <option value="name">Nome (A-Z)</option>
        </select>
      </div>

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-mid">Nenhum contato encontrado.</p>
          {canEdit && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              Criar o primeiro contato
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {contacts.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelectedId(c.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-text-mid">
                  {initials(c.displayName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">
                    {c.displayName ?? 'Sem nome'}
                  </span>
                  <span className="block truncate text-xs text-text-low">
                    {c.phone ?? c.email ?? '—'}
                  </span>
                </span>
                {c.marketingOptIn && (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                    opt-in
                  </span>
                )}
                <span className="text-xs text-text-low">{c.source ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-low">
            Página {data.page} de {data.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="ghost"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
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
