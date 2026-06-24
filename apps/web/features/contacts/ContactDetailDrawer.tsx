'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, X } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { can, type Role } from '@hm/shared';
import { MarkConversionButton } from '@/features/conversions';
import { ContactPanel } from './components/ContactPanel';
import { cn } from '@/shared/lib/cn';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useAssignTag, useContact, useRemoveTag, useTags } from './queries';
import type { ConsentEntry } from './types';

type Tab = 'dados' | 'conversas' | 'deals' | 'conversoes' | 'consentimento';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'dados', label: 'Dados' },
  { id: 'conversas', label: 'Conversas' },
  { id: 'deals', label: 'Deals' },
  { id: 'conversoes', label: 'Conversões' },
  { id: 'consentimento', label: 'Consentimento' },
];

function formatBRL(cents: number | null, currency: string): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

function dt(value: string | null): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

interface ContactDetailDrawerProps {
  contactId: string | null;
  role: Role | undefined;
  onClose: () => void;
  onEdit: (id: string) => void;
}

/** Drawer lateral de detalhe do contato com tabs. */
export function ContactDetailDrawer({
  contactId,
  role,
  onClose,
  onEdit,
}: ContactDetailDrawerProps): React.JSX.Element | null {
  const [tab, setTab] = useState<Tab>('dados');
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const detail = useContact(contactId);
  const tagsQuery = useTags();
  const assignTag = useAssignTag();
  const removeTag = useRemoveTag();
  const [tagToAdd, setTagToAdd] = useState('');

  if (!contactId) return null;

  const canEdit = role ? can(role, 'contact.edit') : false;
  const data = detail.data;
  const c = data?.contact;
  const availableTags = (tagsQuery.data?.tags ?? []).filter(
    (t) => !(data?.tags ?? []).some((ct) => ct.id === t.id),
  );

  const actions = (canEdit && c) || c ? (
    <div className="flex items-center gap-2">
      {canEdit && c && (
        <Button variant="secondary" onClick={() => onEdit(c.id)}>
          <Pencil className="size-4" />
          Editar
        </Button>
      )}
      {c && <MarkConversionButton contactId={c.id} variant="secondary" />}
    </div>
  ) : null;

  const tabsNav = (
    <nav className="flex gap-1 overflow-x-auto" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={cn(
            'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            tab === t.id
              ? 'border-brand text-text'
              : 'border-transparent text-text-low hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );

  const detailBody = (
    <>
      {detail.isLoading && <p className="text-sm text-text-low">Carregando…</p>}
          {detail.isError && (
            <p className="text-sm text-danger">Falha ao carregar contato.</p>
          )}

          {data && c && tab === 'dados' && (
            <div className="flex flex-col gap-4">
              {/* Cadastro vivo (nome/telefone/e-mail/documento/endereço/custom
                  fields/resumo) reusa o <ContactPanel> — sem duplicar a
                  renderização. Editável conforme `contact.edit` (§2.3 cadastro no
                  drawer; §3.1 read-only quando sem permissão). */}
              <ContactPanel contactId={c.id} editable />

              {/* Metadados que o painel não cobre (origem/idioma/criado/marketing). */}
              <dl className="grid grid-cols-1 gap-3 border-t border-border-2 pt-4 text-sm">
                <Field label="Origem" value={c.source ?? '—'} />
                <Field label="Idioma" value={c.language ?? '—'} />
                <Field label="Criado em" value={dt(c.createdAt ?? null)} />
                <Field
                  label="Marketing"
                  value={data.marketingOptIn ? 'Opt-in ativo' : 'Sem opt-in'}
                />
              </dl>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-low">
                  Tags
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {(data.tags ?? []).map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-text"
                      style={{ borderColor: t.color }}
                    >
                      {t.name}
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remover tag ${t.name}`}
                          onClick={() =>
                            removeTag.mutate(
                              { contactId: c!.id, tagId: t.id },
                              {
                                onError: (e) => toast({ variant: 'error', title: e.message }),
                              },
                            )
                          }
                          className="text-text-low hover:text-danger"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {(data.tags ?? []).length === 0 && (
                    <span className="text-xs text-text-low">Sem tags.</span>
                  )}
                </div>
                {canEdit && availableTags.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={tagToAdd}
                      onChange={(e) => setTagToAdd(e.target.value)}
                      aria-label="Adicionar tag"
                      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                    >
                      <option value="">Selecionar tag…</option>
                      {availableTags.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!tagToAdd || assignTag.isPending}
                      onClick={() =>
                        assignTag.mutate(
                          { contactId: c!.id, tagId: tagToAdd },
                          {
                            onSuccess: () => setTagToAdd(''),
                            onError: (e) => toast({ variant: 'error', title: e.message }),
                          },
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-mid hover:text-text disabled:opacity-50"
                    >
                      <Plus className="size-3" />
                      Adicionar
                    </button>
                  </div>
                )}
              </section>

              {c?.notes && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-low">
                    Notas
                  </h3>
                  <p className="whitespace-pre-wrap text-sm text-text-mid">{c.notes}</p>
                </section>
              )}
            </div>
          )}

          {data && tab === 'conversas' && (
            <ul className="flex flex-col gap-2">
              {data.conversations.length === 0 && (
                <li className="text-sm text-text-low">Nenhuma conversa.</li>
              )}
              {data.conversations.map((conv) => (
                <li key={conv.id}>
                  <Link
                    href={`/conversations/${conv.id}`}
                    className="flex flex-col rounded-md border border-border px-3 py-2 hover:bg-surface-2"
                  >
                    <span className="text-sm text-text">{conv.lastMessagePreview ?? 'Conversa'}</span>
                    <span className="text-xs text-text-low">
                      {conv.status} · {dt(conv.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {data && tab === 'deals' && (
            <ul className="flex flex-col gap-2">
              {data.deals.length === 0 && <li className="text-sm text-text-low">Nenhum deal.</li>}
              {data.deals.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-text">{d.title}</span>
                    <span className="text-xs text-text-low">
                      {d.closedAt
                        ? d.closedWon
                          ? 'Ganho'
                          : 'Perdido'
                        : 'Em aberto'}
                    </span>
                  </div>
                  <span className="text-sm text-text-mid">{formatBRL(d.valueCents, d.currency)}</span>
                </li>
              ))}
            </ul>
          )}

          {data && tab === 'conversoes' && (
            <ul className="flex flex-col gap-2">
              {data.conversions.length === 0 && (
                <li className="text-sm text-text-low">Nenhuma conversão.</li>
              )}
              {data.conversions.map((cv) => (
                <li
                  key={cv.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-text">{cv.typeLabel ?? 'Conversão'}</span>
                    <span className="text-xs text-text-low">
                      {dt(cv.occurredAt)}
                      {cv.cancelledAt ? ' · cancelada' : ''}
                    </span>
                  </div>
                  <span className="text-sm text-text-mid">{formatBRL(cv.valueCents, cv.currency)}</span>
                </li>
              ))}
            </ul>
          )}

          {data && tab === 'consentimento' && (
            <ConsentTimeline entries={data.consent} optIn={data.marketingOptIn} />
          )}
    </>
  );

  const heading = c?.displayName ?? (detail.isLoading ? 'Carregando…' : 'Contato');

  // Mobile (< md): detalhe em full-`Sheet` (UX §2.3 — drawer vira sheet).
  if (isMobile) {
    return (
      <Sheet
        open
        onClose={onClose}
        variant="full"
        title={heading}
        ariaLabel="Detalhe do contato"
        footer={actions}
      >
        <div className="-mx-5 mb-3 border-b border-border px-3">{tabsNav}</div>
        {detailBody}
      </Sheet>
    );
  }

  // Desktop (md+): drawer lateral inalterado.
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface"
        role="dialog"
        aria-label="Detalhe do contato"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-head text-base font-semibold text-text">{heading}</h2>
            {c?.phone && <p className="truncate text-xs text-text-low">{c.phone}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-sm p-1 text-text-low hover:text-text"
          >
            <X className="size-5" />
          </button>
        </header>

        {actions && <div className="border-b border-border px-5 py-3">{actions}</div>}

        <div className="border-b border-border px-3">{tabsNav}</div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{detailBody}</div>
      </aside>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 border-b border-border/40 pb-2">
      <dt className="text-text-low">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}

function ConsentTimeline({
  entries,
  optIn,
}: {
  entries: ConsentEntry[];
  optIn: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-mid">
        Status atual:{' '}
        <span className={optIn ? 'text-success' : 'text-text-low'}>
          {optIn ? 'Opt-in ativo' : 'Sem consentimento'}
        </span>
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-text-low">Sem histórico de consentimento.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((e, i) => (
            <li key={`${e.kind}-${i}`} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-sm font-medium',
                    e.kind === 'opt_in' ? 'text-success' : 'text-danger',
                  )}
                >
                  {e.kind === 'opt_in' ? 'Opt-in' : 'Opt-out'}
                </span>
                <span className="text-xs text-text-low">{dt(e.at)}</span>
              </div>
              <p className="mt-0.5 text-xs text-text-low">
                {e.kind === 'opt_in'
                  ? `Método: ${e.method ?? '—'}${e.source ? ` · ${e.source}` : ''}`
                  : `Motivo: ${e.reason ?? '—'}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
