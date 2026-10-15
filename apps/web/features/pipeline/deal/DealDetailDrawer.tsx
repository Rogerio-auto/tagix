'use client';

import { ExternalLink } from 'lucide-react';
import { Drawer } from '@hm/ui';
import { Skeleton } from '@/shared/components/feedback';
import { CustomFieldsView, type CustomFieldDef, type CustomFieldValues } from '../custom-fields';
import { MarkConversionButton } from '@/features/conversions';
import { ContactPanel } from '@/features/contacts/components/ContactPanel';
import { CardImageCapture } from './CardImageCapture';
import { CardImageGallery } from './CardImageGallery';
import { HistoryTimeline } from './HistoryTimeline';
import { formatMoney } from '../board/format';
import {
  useDeal,
  useDealAttachments,
  useDealHistory,
  useDeleteAttachment,
} from './queries';

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-text-low">{title}</h3>
      {children}
    </section>
  );
}

export interface DealDetailDrawerProps {
  dealId: string | null;
  /** Defs de custom fields do pipeline (de F5-S11/S04). */
  customFieldDefs?: CustomFieldDef[];
  canEdit?: boolean;
  onClose: () => void;
}

/**
 * Drawer lateral de detalhe do deal (F5-S10, PIPELINE.md §9.3; UX §2.3). Usa o `Drawer`
 * do DS (focus-trap, Esc, scroll-lock, retorno de foco; vira bottom-sheet no mobile).
 * Sections: ações, cliente, custom fields, fotos, histórico, link p/ conversa.
 */
export function DealDetailDrawer({
  dealId,
  customFieldDefs = [],
  canEdit = false,
  onClose,
}: DealDetailDrawerProps): React.JSX.Element {
  const dealQuery = useDeal(dealId ?? undefined);
  const historyQuery = useDealHistory(dealId ?? undefined);
  const attachmentsQuery = useDealAttachments(dealId ?? undefined);
  const deleteAttachment = useDeleteAttachment(dealId ?? '');

  const deal = dealQuery.data?.deal;

  return (
    <Drawer
      open={dealId !== null}
      onClose={onClose}
      title={dealQuery.isLoading ? 'Carregando…' : (deal?.title ?? 'Negócio')}
      description={
        deal && deal.valueCents > 0 ? (
          <span className="font-mono font-semibold tabular-nums text-brand-text">
            {formatMoney(deal.valueCents, deal.currency)}
          </span>
        ) : undefined
      }
      ariaLabel="Detalhe do negócio"
      className="sm:max-w-md"
    >
      {dealQuery.isError ? (
        <p role="alert" className="pb-4 font-body text-sm text-danger">
          Não foi possível carregar o negócio. Feche e abra de novo; se persistir, recarregue a página.
        </p>
      ) : null}

      {deal?.contactId ? (
        <Section title="Ações">
          <MarkConversionButton contactId={deal.contactId} dealId={deal.id} variant="secondary" />
        </Section>
      ) : null}

      {/* Cadastro vivo do cliente (read-through). Read-only: na pipeline nunca
          editamos o cadastro daqui — §3.1 evita edição acidental fora do cockpit. */}
      {deal?.contactId ? (
        <Section title="Cliente">
          <ContactPanel contactId={deal.contactId} />
        </Section>
      ) : null}

      {customFieldDefs.length > 0 && deal ? (
        <Section title="Campos">
          <CustomFieldsView defs={customFieldDefs} values={deal.customFields as CustomFieldValues} />
        </Section>
      ) : null}

      {dealId ? (
        <Section title="Fotos">
          {canEdit ? <CardImageCapture dealId={dealId} /> : null}
          <CardImageGallery
            attachments={attachmentsQuery.data?.attachments ?? []}
            onDelete={canEdit ? (id) => deleteAttachment.mutate(id) : undefined}
            disabled={deleteAttachment.isPending}
          />
        </Section>
      ) : null}

      <Section title="Histórico">
        {historyQuery.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <HistoryTimeline entries={historyQuery.data?.history ?? []} />
        )}
      </Section>

      {deal?.contactId ? (
        <Section title="Conversa">
          <a
            href={`/conversations?contactId=${deal.contactId}`}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 font-body text-sm font-bold text-text-mid outline-none transition-colors hover:border-border-brand hover:text-text focus-visible:focus-ring"
          >
            Abrir conversa
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </Section>
      ) : null}
    </Drawer>
  );
}
