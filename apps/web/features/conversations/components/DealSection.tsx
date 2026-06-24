'use client';

/**
 * Seção Card/Negócio do Cockpit (F47-S07, COCKPIT_CLIENT_ENRICHMENT §5).
 *
 * Conecta a conversa ao CARD (deal) na pipeline:
 *  - SEM deal → empty state (§2.6) com CTA explícito "Criar card na pipeline"
 *    (POST /api/conversations/:id/deal; o backend escolhe pipeline/estágio default).
 *    Também permite lançar o 1º item/valor direto: o AUTO-ENRICH cria o card antes
 *    de adicionar o item (feedback honesto "Card criado").
 *  - COM deal → estágio + valor (BRL, autoritativo do servidor) + link para o board,
 *    e o subpainel de itens (<DealItemsEditor>).
 *
 * AUTORIDADE DO VALOR (UX §2.7): o valor exibido é `deal.valueCents` que vem do
 * detalhe da conversa (read-through), recomputado no servidor a cada mutação de
 * item. Nunca somamos no cliente — evita o drift que o S11 vai caçar.
 *
 * Gate: criar card / mexer em itens = `deal.edit` (STAFF). READONLY vê estágio,
 * valor e itens, mas sem controles de mutação.
 *
 * UX: §2.4 (CTA com label e path óbvio, não menu escondido), §2.6, §2.7, §8 mobile.
 * DS v2: zero hex; tokens border-border-2 / bg-surface-2 / text-text/-mid/-low.
 * Sem neon brand aqui (o teto de 1×/tela fica reservado ao toggle de IA e ao
 * resumo financeiro do contato). Alvos ≥44px. Apenas o valor em destaque tipográfico.
 */

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, FileText, Plus } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import type { ConversationDeal } from '../types';
import { useAddDealItem, useCreateConversationDeal } from '../queries';
import { AddItemForm, DealItemsEditor, type NewItemInput } from './DealItemsEditor';

const currencyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatCents(cents: number, currency = 'BRL'): string {
  if (currency !== 'BRL') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
  }
  return currencyFmt.format(cents / 100);
}

export function DealSection({
  conversationId,
  deal,
  canEdit,
}: {
  conversationId: string;
  /** Card vinculado (read-through do detalhe da conversa) — `null` se não há. */
  deal: ConversationDeal | null;
  /** `deal.edit` resolvido pelo chamador. */
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const createDeal = useCreateConversationDeal();
  const addItem = useAddDealItem();

  // No-deal: alterna entre o CTA e o formulário de auto-enrich (1º item cria o card).
  const [enriching, setEnriching] = useState(false);

  const busy = createDeal.isPending || addItem.isPending;

  function handleCreateEmpty(): void {
    if (createDeal.isPending) return;
    createDeal.mutate(
      { conversationId },
      {
        onSuccess: () => toast({ title: 'Card criado na pipeline', variant: 'success' }),
        onError: () => toast({ title: 'Falha ao criar o card', variant: 'error' }),
      },
    );
  }

  /**
   * Auto-enrich: sem deal, lançar o 1º item primeiro CRIA o card e só então
   * adiciona o item (a resposta do create traz o `deal.id`). Feedback honesto:
   * o toast diz "Card criado" porque o card nasceu nesta ação.
   */
  function handleAutoEnrich(input: NewItemInput): void {
    if (busy) return;
    createDeal.mutate(
      { conversationId },
      {
        onSuccess: ({ deal: created }) => {
          addItem.mutate(
            { dealId: created.id, conversationId, ...input },
            {
              onSuccess: () => {
                toast({ title: 'Card criado e item lançado', variant: 'success' });
                setEnriching(false);
              },
              onError: () =>
                toast({
                  title: 'Card criado, mas o item falhou',
                  description: 'Tente adicionar o item novamente.',
                  variant: 'error',
                }),
            },
          );
        },
        onError: () => toast({ title: 'Falha ao criar o card', variant: 'error' }),
      },
    );
  }

  // ── Sem deal: empty state + CTA + auto-enrich ────────────────────────────────
  if (!deal) {
    if (!canEdit) {
      return (
        <p className="font-body text-sm text-text-low">
          Esta conversa ainda não tem um card na pipeline.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2.5">
          <FileText className="mt-0.5 size-4 shrink-0 text-text-low" aria-hidden />
          <p className="font-body text-xs text-text-mid">
            Materialize esta conversa como um card na pipeline para acompanhar o negócio e
            registrar o valor.
          </p>
        </div>

        {enriching ? (
          <AddItemForm
            onAdd={handleAutoEnrich}
            isPending={busy}
            onCancel={() => setEnriching(false)}
            submitLabel="Lançar e criar card"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={createDeal.isPending && !addItem.isPending}
              onClick={handleCreateEmpty}
            >
              Criar card na pipeline
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              leftIcon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setEnriching(true)}
            >
              Lançar produto / valor
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Com deal: estágio + valor + link + itens ─────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-body text-xs text-text-low">Estágio</p>
          <p className="truncate font-body text-sm font-medium text-text">
            {deal.stageName ?? '—'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-body text-xs text-text-low">Valor</p>
          <p className="font-price text-base font-semibold text-text">
            {formatCents(deal.valueCents, deal.currency)}
          </p>
        </div>
      </div>

      <Link
        href={`/pipeline?deal=${deal.id}`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm font-body text-sm font-medium text-text-mid outline-none hover:text-text focus-visible:shadow-glow-md"
      >
        Abrir card no board
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>

      <div className="border-t border-border-2 pt-3">
        <p className="mb-2 font-body text-xs font-medium text-text-low">Itens</p>
        <DealItemsEditor dealId={deal.id} conversationId={conversationId} canEdit={canEdit} />
      </div>
    </div>
  );
}
