'use client';

/**
 * Seção Conversão do Cockpit (F47-S08, COCKPIT_CLIENT_ENRICHMENT / DASHBOARD §13).
 *
 * Aciona a marcação de conversão de dentro do cockpit, REUSANDO o
 * `MarkConversionModal` (F5-S13) — não recria formulário nem resumo. O valor é
 * HERDADO do card (`deal.valueCents`) e vai pré-preenchido no modal, sem travar
 * a edição. Sem deal, o botão ainda funciona (sem valor herdado).
 *
 * O resumo financeiro do contato (total convertido / nº de deals / ticket médio)
 * já vive na seção Cliente (<ContactPanel>, F47-S06) — aqui NÃO duplicamos.
 *
 * Gate: `deal.convert` (STAFF). READONLY não vê o botão (resolvido pelo chamador).
 *
 * UX: §2.3 (reusa modal/sheet responsivo, não tela cheia), §2.7 (botão com
 * feedback; dedup 409 amigável no próprio modal). DS v2: zero hex, tokens
 * semânticos; sem neon brand (reservado ao toggle de IA / resumo financeiro).
 */

import { useState } from 'react';
import { Target } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@hm/ui';
import { MarkConversionModal } from '@/features/conversions/MarkConversionModal';

const currencyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function ConversionSection({
  contactId,
  conversationId,
  dealId,
  valueCents,
}: {
  contactId: string;
  conversationId: string;
  /** Card vinculado — `null` quando a conversa não tem deal. */
  dealId: string | null;
  /** Valor (centavos) do card a herdar — `null` quando não há valor. */
  valueCents: number | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const hasInheritedValue = valueCents != null && valueCents > 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs text-text-mid">
        Registre o resultado deste atendimento. A conversão entra no funil e no resumo
        financeiro do contato.
      </p>

      {hasInheritedValue ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2.5">
          <span className="font-body text-xs text-text-low">Valor do card (herdado)</span>
          <span className="font-price text-sm font-semibold text-text">
            {currencyFmt.format(valueCents / 100)}
          </span>
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        leftIcon={<Target className="size-4" aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Marcar conversão
      </Button>

      <MarkConversionModal
        open={open}
        onClose={() => setOpen(false)}
        contactId={contactId}
        conversationId={conversationId}
        dealId={dealId}
        valueCents={valueCents}
        onRegistered={() => {
          // Refletir a conversão no cockpit e no resumo financeiro do contato
          // (S06, dentro do <ContactPanel>): invalida o detalhe da conversa e o
          // detalhe do contato. As conversões em si já são invalidadas no hook.
          void qc.invalidateQueries({ queryKey: ['conversation', conversationId, 'detail'] });
          void qc.invalidateQueries({ queryKey: ['contacts', 'detail', contactId] });
        }}
      />
    </div>
  );
}
