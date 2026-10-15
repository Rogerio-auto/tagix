'use client';

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Pencil, Plus, X } from 'lucide-react';
import { Button, Drawer, ErrorState, SkeletonText, StatusPill, useToast } from '@hm/ui';
import { can, type Role } from '@hm/shared';
import { MarkConversionButton } from '@/features/conversions';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { formatDateTime, formatMoney } from '@/shared/lib/locale';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ContactPanel } from './components/ContactPanel';
import { useAssignTag, useContact, useRemoveTag, useTags } from './queries';
import { controlClass, eyebrowClass } from './styles';
import type { ConsentEntry } from './types';

type Tab = 'dados' | 'conversas' | 'deals' | 'conversoes' | 'consentimento';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'dados', label: 'Dados' },
  { id: 'conversas', label: 'Conversas' },
  { id: 'deals', label: 'Negócios' },
  { id: 'conversoes', label: 'Conversões' },
  { id: 'consentimento', label: 'Consentimento' },
];

interface ContactDetailDrawerProps {
  contactId: string | null;
  role: Role | undefined;
  onClose: () => void;
  onEdit: (id: string) => void;
}

/**
 * Detalhe do contato (UX §2.3: Drawer lateral no desktop, sheet cheio no mobile) com
 * abas WAI-ARIA (setas, Home/End). Números e datas em mono tabular; escrita guardada
 * pelo modo só leitura (Editar, adicionar/remover tag).
 */
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
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (!contactId) return null;

  const canEdit = role ? can(role, 'contact.edit') : false;
  const data = detail.data;
  const c = data?.contact;
  const availableTags = (tagsQuery.data?.tags ?? []).filter(
    (t) => !(data?.tags ?? []).some((ct) => ct.id === t.id),
  );

  const actions = c ? (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <ReadOnlyGuard align="start">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Pencil className="size-4" aria-hidden />}
            onClick={() => onEdit(c.id)}
          >
            Editar
          </Button>
        </ReadOnlyGuard>
      )}
      <MarkConversionButton contactId={c.id} variant="secondary" size="sm" />
    </div>
  ) : null;

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = TABS.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[next];
    if (!target) return;
    setTab(target.id);
    tabRefs.current[next]?.focus();
  };

  const tabsNav = (
    <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Seções do contato">
      {TABS.map((t, i) => {
        const selected = tab === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${baseId}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 font-body text-sm font-bold outline-none',
              'transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring',
              selected
                ? 'border-brand-text text-text'
                : 'border-transparent text-text-low hover:text-text',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const empty = (text: string): ReactNode => (
    <p className="rounded-md border border-dashed border-border px-4 py-6 text-center font-body text-sm text-text-low">
      {text}
    </p>
  );

  const panel = (
    <div
      role="tabpanel"
      id={`${baseId}-panel`}
      aria-labelledby={`${baseId}-tab-${tab}`}
      tabIndex={0}
      className="outline-none focus-visible:focus-ring"
    >
      {detail.isLoading && <SkeletonText lines={5} />}
      {detail.isError && (
        <ErrorState
          title="Não foi possível abrir o contato"
          reason="A consulta ao contato falhou."
          whatToDo="Verifique a conexão e tente novamente."
          action={
            <Button variant="secondary" size="sm" onClick={() => void detail.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      )}

      {data && c && tab === 'dados' && (
        <div className="flex flex-col gap-6">
          {/* Cadastro vivo (nome/telefone/e-mail/documento/endereço/custom fields/resumo)
              reusa o <ContactPanel>; editável conforme `contact.edit`. */}
          <ContactPanel contactId={c.id} editable />

          <section aria-labelledby={`${baseId}-meta`} className="border-t border-border pt-5">
            <h3 id={`${baseId}-meta`} className={cn(eyebrowClass, 'mb-3')}>
              Origem e consentimento
            </h3>
            <dl className="flex flex-col">
              <Field label="Origem" value={c.source ?? '—'} />
              <Field label="Idioma" value={c.language ?? '—'} />
              <Field label="Criado em" value={formatDateTime(c.createdAt)} mono />
              <Field label="Marketing" value={data.marketingOptIn ? 'Opt-in ativo' : 'Sem opt-in'} />
            </dl>
          </section>

          <section aria-labelledby={`${baseId}-tags`}>
            <h3 id={`${baseId}-tags`} className={cn(eyebrowClass, 'mb-3')}>
              Tags
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {(data.tags ?? []).map((t) => (
                <span
                  key={t.id}
                  className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-border bg-surface-2 pl-2.5 pr-1 font-body text-xs font-bold text-text-mid"
                >
                  {/* A cor é dado da tag (cadastrada pelo cliente), não estilo: só no ponto. */}
                  <i aria-hidden className="size-2 rounded-pill" style={{ backgroundColor: t.color }} />
                  {t.name}
                  {canEdit && (
                    <ReadOnlyGuard align="start">
                      <button
                        type="button"
                        aria-label={`Remover tag ${t.name}`}
                        onClick={() =>
                          removeTag.mutate(
                            { contactId: c.id, tagId: t.id },
                            { onError: (e) => toast({ variant: 'error', title: e.message }) },
                          )
                        }
                        className="grid size-5 place-items-center rounded-pill text-text-low outline-none transition-colors hover:bg-danger/10 hover:text-danger focus-visible:focus-ring"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </ReadOnlyGuard>
                  )}
                </span>
              ))}
              {(data.tags ?? []).length === 0 && (
                <span className="font-body text-sm text-text-low">Sem tags.</span>
              )}
            </div>
            {canEdit && availableTags.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={tagToAdd}
                  onChange={(e) => setTagToAdd(e.target.value)}
                  aria-label="Adicionar tag"
                  className={cn(controlClass, 'h-8 min-w-0 flex-1')}
                >
                  <option value="">Selecionar tag…</option>
                  {availableTags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ReadOnlyGuard>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Plus className="size-3.5" aria-hidden />}
                    disabled={!tagToAdd}
                    loading={assignTag.isPending}
                    onClick={() =>
                      assignTag.mutate(
                        { contactId: c.id, tagId: tagToAdd },
                        {
                          onSuccess: () => setTagToAdd(''),
                          onError: (e) => toast({ variant: 'error', title: e.message }),
                        },
                      )
                    }
                  >
                    Adicionar
                  </Button>
                </ReadOnlyGuard>
              </div>
            )}
          </section>

          {c.notes && (
            <section aria-labelledby={`${baseId}-notes`}>
              <h3 id={`${baseId}-notes`} className={cn(eyebrowClass, 'mb-2')}>
                Notas
              </h3>
              <p className="whitespace-pre-wrap font-body text-sm text-text-mid">{c.notes}</p>
            </section>
          )}
        </div>
      )}

      {data && tab === 'conversas' &&
        (data.conversations.length === 0 ? (
          empty('Nenhuma conversa com este contato.')
        ) : (
          <ul className="flex flex-col gap-2">
            {data.conversations.map((conv) => (
              <li key={conv.id}>
                <Link
                  href={`/conversations/${conv.id}`}
                  className="group flex items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-3 outline-none transition-colors duration-(--dur-fast) hover:border-border-2 hover:bg-surface-2 focus-visible:focus-ring"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-body text-sm text-text">
                      {conv.lastMessagePreview ?? 'Conversa'}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-text-low">
                      {conv.status} · {formatDateTime(conv.lastMessageAt)}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-text-low transition-transform duration-(--dur-fast) motion-safe:group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {data && tab === 'deals' &&
        (data.deals.length === 0 ? (
          empty('Nenhum negócio com este contato.')
        ) : (
          <ul className="flex flex-col gap-2">
            {data.deals.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3.5 py-3"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-body text-sm text-text">{d.title}</span>
                  {d.closedAt ? (
                    d.closedWon ? (
                      <StatusPill tone="success" size="sm">
                        Ganho
                      </StatusPill>
                    ) : (
                      <StatusPill tone="danger" size="sm">
                        Perdido
                      </StatusPill>
                    )
                  ) : (
                    <StatusPill tone="info" size="sm">
                      Em aberto
                    </StatusPill>
                  )}
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-text">
                  {formatMoney(d.valueCents, d.currency)}
                </span>
              </li>
            ))}
          </ul>
        ))}

      {data && tab === 'conversoes' &&
        (data.conversions.length === 0 ? (
          empty('Nenhuma conversão registrada para este contato.')
        ) : (
          <ul className="flex flex-col gap-2">
            {data.conversions.map((cv) => (
              <li
                key={cv.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3.5 py-3',
                  cv.cancelledAt && 'bg-surface-2',
                )}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-body text-sm text-text">
                    {cv.typeLabel ?? 'Conversão'}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-text-low">
                    {formatDateTime(cv.occurredAt)}
                    {cv.cancelledAt ? ' · cancelada' : ''}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-sm tabular-nums',
                    cv.cancelledAt ? 'text-text-low line-through' : 'text-text',
                  )}
                >
                  {formatMoney(cv.valueCents, cv.currency)}
                </span>
              </li>
            ))}
          </ul>
        ))}

      {data && tab === 'consentimento' && (
        <ConsentTimeline entries={data.consent} optIn={data.marketingOptIn} />
      )}
    </div>
  );

  const heading = c?.displayName ?? (detail.isLoading ? 'Carregando…' : 'Contato');
  const subtitle = c?.phone ? (
    <span className="font-mono tabular-nums">{c.phone}</span>
  ) : (
    (c?.email ?? undefined)
  );

  // Mobile (< md): sheet cheio (UX §2.3 — o drawer vira sheet).
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
        <div className="-mx-5 mb-4 border-b border-border px-3">{tabsNav}</div>
        {panel}
      </Sheet>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={heading}
      description={subtitle}
      ariaLabel="Detalhe do contato"
      className="max-w-lg"
      footer={actions}
    >
      <div className="-mx-5 mb-5 border-b border-border px-3">{tabsNav}</div>
      {panel}
    </Drawer>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="font-body text-sm text-text-low">{label}</dt>
      <dd className={cn('text-right text-sm text-text', mono ? 'font-mono tabular-nums' : 'font-body')}>
        {value}
      </dd>
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-body text-sm text-text-mid">Status atual</span>
        <StatusPill tone={optIn ? 'success' : 'neutral'}>
          {optIn ? 'Opt-in ativo' : 'Sem consentimento'}
        </StatusPill>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center font-body text-sm text-text-low">
          Sem histórico de consentimento.
        </p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
          {entries.map((e, i) => (
            <li key={`${e.kind}-${i}`} className="relative">
              <i
                aria-hidden
                className={cn(
                  'absolute -left-5.25 top-1.5 size-2 rounded-pill ring-4 ring-surface',
                  e.kind === 'opt_in' ? 'bg-success' : 'bg-danger',
                )}
              />
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    'font-body text-sm font-bold',
                    e.kind === 'opt_in' ? 'text-success' : 'text-danger',
                  )}
                >
                  {e.kind === 'opt_in' ? 'Opt-in' : 'Opt-out'}
                </span>
                <span className="font-mono text-xs tabular-nums text-text-low">
                  {formatDateTime(e.at)}
                </span>
              </div>
              <p className="mt-0.5 font-body text-xs text-text-low">
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
