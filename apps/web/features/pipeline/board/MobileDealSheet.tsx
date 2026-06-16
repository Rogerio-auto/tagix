'use client';

import { ExternalLink } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet';
import { MarkConversionButton } from '@/features/conversions';
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

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle py-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-low">{title}</h3>
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
        <p className="-mt-2 mb-4 text-sm text-text-mid">{formatBRL(deal.valueCents)}</p>
      ) : null}

      {dealQuery.isError ? (
        <p className="py-4 text-sm text-danger">Não foi possível carregar o negócio.</p>
      ) : null}

      {deal?.contactId ? (
        <Section title="Ações">
          <MarkConversionButton contactId={deal.contactId} dealId={deal.id} variant="secondary" />
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
          <div className="h-16 animate-pulse rounded bg-surface-raised" />
        ) : (
          <HistoryTimeline entries={historyQuery.data?.history ?? []} />
        )}
      </Section>

      {deal?.contactId ? (
        <Section title="Conversa">
          <a
            href={`/conversations?contactId=${deal.contactId}`}
            className="touch-target inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-mid hover:border-border-strong hover:text-text focus-visible:shadow-glow-md"
          >
            Abrir conversa
            <ExternalLink className="size-4" />
          </a>
        </Section>
      ) : null}
    </Sheet>
  );
}
