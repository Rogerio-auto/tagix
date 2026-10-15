'use client';

import { ExternalLink } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet';
import { Skeleton } from '@/shared/components/feedback';
import { formatMoney } from './format';
import { MarkConversionButton } from '@/features/conversions';
import { ContactPanel } from '@/features/contacts/components/ContactPanel';
import {
  CardImageCapture,
  CardImageGallery,
  HistoryTimeline,
  useDeal,
  useDealAttachments,
  useDealHistory,
  useDeleteAttachment,
} from '../deal';
import { CustomFieldsView, type CustomFieldDef, type CustomFieldValues } from '../custom-fields';

export interface MobileDealSheetProps {
  /** Deal aberto; `null` mantém o sheet fechado. */
  dealId: string | null;
  /** Defs de custom fields do pipeline (de F5-S11/S04). */
  customFieldDefs?: CustomFieldDef[];
  canEdit?: boolean;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-text-low">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Detalhe do deal no mobile como bottom-`Sheet` (MOBILE_UX §2.3: drawer → sheet;
 * UX §2.1 ação primária = tocar o card abre o detalhe). Reúsa as queries e os
 * componentes ricos da feature `deal` (fotos/histórico/conversão) sem duplicar
 * lógica — equivalente funcional ao `DealDetailDrawer` do desktop, redesenhado
 * para o toque. Animação/foco/swipe são garantidos pelo primitivo `Sheet`.
 */
export function MobileDealSheet({
  dealId,
  customFieldDefs = [],
  canEdit = false,
  onClose,
}: MobileDealSheetProps): React.JSX.Element {
  const dealQuery = useDeal(dealId ?? undefined);
  const historyQuery = useDealHistory(dealId ?? undefined);
  const attachmentsQuery = useDealAttachments(dealId ?? undefined);
  const deleteAttachment = useDeleteAttachment(dealId ?? '');

  const deal = dealQuery.data?.deal;
  const title = dealQuery.isLoading ? 'Carregando…' : (deal?.title ?? 'Negócio');

  return (
    <Sheet open={dealId !== null} onClose={onClose} variant="full" title={title}>
      {deal && deal.valueCents > 0 ? (
        <p className="-mt-2 mb-4 font-mono text-sm font-semibold tabular-nums text-brand-text">
          {formatMoney(deal.valueCents, deal.currency)}
        </p>
      ) : null}

      {dealQuery.isError ? (
        <p role="alert" className="py-4 font-body text-sm text-danger">
          Não foi possível carregar o negócio. Feche e abra de novo; se persistir, recarregue a página.
        </p>
      ) : null}

      {deal?.contactId ? (
        <Section title="Ações">
          <MarkConversionButton contactId={deal.contactId} dealId={deal.id} variant="secondary" />
        </Section>
      ) : null}

      {/* Cadastro vivo do cliente (read-through), read-only — §3.1/§8: mesmo
          painel da Pipeline desktop dentro do Sheet mobile. */}
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
            className="touch-target inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-mid hover:border-border-brand hover:text-text focus-visible:focus-ring"
          >
            Abrir conversa
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </Section>
      ) : null}
    </Sheet>
  );
}
