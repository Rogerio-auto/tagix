'use client';

import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { CustomFieldsView, type CustomFieldDef, type CustomFieldValues } from '../custom-fields';
import { MarkConversionButton } from '@/features/conversions';
import { CardImageCapture } from './CardImageCapture';
import { CardImageGallery } from './CardImageGallery';
import { HistoryTimeline } from './HistoryTimeline';
import {
  useDeal,
  useDealAttachments,
  useDealHistory,
  useDeleteAttachment,
} from './queries';

export interface DealDetailDrawerProps {
  dealId: string | null;
  /** Defs de custom fields do pipeline (de F5-S11/S04). */
  customFieldDefs?: CustomFieldDef[];
  canEdit?: boolean;
  onClose: () => void;
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle px-5 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-low">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Drawer lateral de detalhe do deal (F5-S10, PIPELINE.md §9.3). Slide-in (NÃO
 * modal full-screen — anti-padrão v1). Sections: header, custom fields, history,
 * anexos (capture + gallery), link p/ conversa. DS v2: tokens, zero hex.
 */
export function DealDetailDrawer({
  dealId,
  customFieldDefs = [],
  canEdit = false,
  onClose,
}: DealDetailDrawerProps): React.JSX.Element | null {
  const dealQuery = useDeal(dealId ?? undefined);
  const historyQuery = useDealHistory(dealId ?? undefined);
  const attachmentsQuery = useDealAttachments(dealId ?? undefined);
  const deleteAttachment = useDeleteAttachment(dealId ?? '');

  useEffect(() => {
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    if (dealId) window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [dealId, onClose]);

  if (!dealId) return null;

  const deal = dealQuery.data?.deal;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="flex-1 bg-black/40"
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface shadow-elev-4">
        <header className="flex items-start justify-between gap-4 px-5 py-4">
          <div className="flex flex-col gap-1">
            {dealQuery.isLoading ? (
              <div className="h-5 w-40 animate-pulse rounded bg-surface-raised" />
            ) : (
              <h2 className="text-base font-semibold text-text">{deal?.title ?? 'Negócio'}</h2>
            )}
            {deal && deal.valueCents > 0 ? (
              <p className="text-sm text-text-mid">{formatBRL(deal.valueCents)}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-text-low hover:text-text"
          >
            <X className="size-5" />
          </button>
        </header>

        {dealQuery.isError ? (
          <p className="px-5 py-4 text-sm text-danger">Não foi possível carregar o negócio.</p>
        ) : null}

        {deal?.contactId ? (
          <Section title="Ações">
            <MarkConversionButton
              contactId={deal.contactId}
              dealId={deal.id}
              variant="secondary"
            />
          </Section>
        ) : null}

        {customFieldDefs.length > 0 && deal ? (
          <Section title="Campos">
            <CustomFieldsView defs={customFieldDefs} values={deal.customFields as CustomFieldValues} />
          </Section>
        ) : null}

        <Section title="Fotos">
          {canEdit ? <CardImageCapture dealId={dealId} /> : null}
          <CardImageGallery
            attachments={attachmentsQuery.data?.attachments ?? []}
            onDelete={canEdit ? (id) => deleteAttachment.mutate(id) : undefined}
            disabled={deleteAttachment.isPending}
          />
        </Section>

        <Section title="Histórico">
          {historyQuery.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-surface-raised" />
          ) : (
            <HistoryTimeline entries={historyQuery.data?.history ?? []} />
          )}
        </Section>

        {deal?.contactId ? (
          <Section title="Conversa">
            <a
              href={`/conversations?contactId=${deal.contactId}`}
              className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-mid hover:border-border-strong hover:text-text"
            >
              Abrir conversa
              <ExternalLink className="size-4" />
            </a>
          </Section>
        ) : null}
      </aside>
    </div>
  );
}
