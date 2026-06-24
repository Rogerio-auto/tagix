'use client';

/**
 * Editor de itens (line-items) do card — subpainel da seção Card/Negócio (F47-S07).
 *
 * Lista os itens do deal, permite adicionar via PRODUTO do catálogo (busca em
 * GET /api/products) ou item AD-HOC (nome + valor), editar qty/preço e remover.
 *
 * AUTORIDADE DO VALOR (UX §2.7): o servidor recompõe `deals.value_cents` em toda
 * mutação e devolve `dealValueCents`. Este componente NUNCA soma como verdade —
 * só exibe os itens; o valor agregado mostrado na `DealSection` vem do detalhe da
 * conversa (read-through), invalidado a cada mutação. Sem soma client-side.
 *
 * Gate: controles de mutação só aparecem com `canEdit` (deal.edit). READONLY vê a
 * lista, não muta.
 *
 * UX: §2.4 (adicionar item tem botão com label, não menu escondido), §2.6 (empty
 * com CTA), §2.7 (botões em loading + toast; valor do servidor), §2.11 (erro em
 * 3 partes). §8 mobile: inputs ≥16px (globals), alvos ≥44px.
 *
 * DS v2: zero hex; tokens border-border-2 / bg-surface-2/-3 / text-text/-mid/-low.
 */

import { useState } from 'react';
import { Check, Package, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ErrorState, Skeleton } from '@/shared/components/feedback';
import { parseToCents } from '@/features/products/money';
import {
  useAddDealItem,
  useDealItems,
  useProductPicker,
  useRemoveDealItem,
  useUpdateDealItem,
  type DealItem,
  type PickerProduct,
} from '../queries';

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

// ── Linha de item (leitura + edição inline) ───────────────────────────────────

function ItemRow({
  item,
  dealId,
  conversationId,
  canEdit,
}: {
  item: DealItem;
  dealId: string;
  conversationId: string;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const update = useUpdateDealItem();
  const remove = useRemoveDealItem();

  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(item.qty));
  const [price, setPrice] = useState((item.unitPriceCents / 100).toFixed(2).replace('.', ','));
  const [confirmRemove, setConfirmRemove] = useState(false);

  function startEdit(): void {
    setQty(String(item.qty));
    setPrice((item.unitPriceCents / 100).toFixed(2).replace('.', ','));
    setEditing(true);
  }

  function save(): void {
    if (update.isPending) return;
    const nextQty = Number(qty);
    const nextCents = parseToCents(price);
    if (!Number.isInteger(nextQty) || nextQty < 1 || nextCents === null) {
      toast({ title: 'Quantidade e valor inválidos', variant: 'error' });
      return;
    }
    update.mutate(
      { dealId, conversationId, itemId: item.id, patch: { qty: nextQty, unitPriceCents: nextCents } },
      {
        onSuccess: () => {
          toast({ title: 'Item atualizado', variant: 'success' });
          setEditing(false);
        },
        onError: () => toast({ title: 'Falha ao atualizar item', variant: 'error' }),
      },
    );
  }

  function handleRemove(): void {
    if (remove.isPending) return;
    remove.mutate(
      { dealId, conversationId, itemId: item.id },
      {
        onSuccess: () => toast({ title: 'Item removido', variant: 'success' }),
        onError: () => toast({ title: 'Falha ao remover item', variant: 'error' }),
      },
    );
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border-2 bg-surface-2 p-2.5">
        <span className="truncate font-body text-sm font-medium text-text">{item.nameSnapshot}</span>
        <div className="flex items-end gap-2">
          <div className="w-16 shrink-0">
            <Input
              label="Qtd"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Valor unit. (R$)"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={update.isPending}
            leftIcon={<Check className="size-3.5" aria-hidden />}
            onClick={save}
          >
            Salvar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => setEditing(false)}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-sm font-medium text-text">{item.nameSnapshot}</p>
        <p className="font-body text-xs text-text-low">
          {item.qty} × {formatCents(item.unitPriceCents, item.currency)}
          {item.productId === null && ' · avulso'}
        </p>
      </div>
      <span className="shrink-0 font-price text-sm font-semibold text-text">
        {formatCents(item.qty * item.unitPriceCents, item.currency)}
      </span>
      {canEdit && (
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Editar ${item.nameSnapshot}`}
            className="flex size-11 items-center justify-center rounded-sm text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
          {confirmRemove ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={remove.isPending}
              aria-label={`Confirmar remoção de ${item.nameSnapshot}`}
              className="flex h-11 items-center justify-center rounded-sm px-2 font-body text-xs font-semibold text-danger outline-none hover:underline focus-visible:shadow-glow-md disabled:opacity-50"
            >
              Confirmar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              aria-label={`Remover ${item.nameSnapshot}`}
              className="flex size-11 items-center justify-center rounded-sm text-text-low outline-none hover:text-danger focus-visible:shadow-glow-md"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Formulário de adicionar item (produto OU ad-hoc) ──────────────────────────

/** Payload normalizado de um item a adicionar (produto OU ad-hoc). */
export interface NewItemInput {
  productId?: string;
  nameSnapshot?: string;
  unitPriceCents?: number;
  qty: number;
}

export function AddItemForm({
  onAdd,
  isPending,
  onCancel,
  submitLabel = 'Adicionar',
}: {
  onAdd: (input: NewItemInput) => void;
  isPending: boolean;
  onCancel: () => void;
  /** Texto do botão primário — o auto-enrich usa "Lançar e criar card". */
  submitLabel?: string;
}) {
  const [mode, setMode] = useState<'product' | 'adhoc'>('product');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PickerProduct | null>(null);
  const [qty, setQty] = useState('1');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  const picker = useProductPicker(search, mode === 'product' && selected === null);
  const products = picker.data?.products ?? [];

  function submit(): void {
    const nextQty = Number(qty);
    if (!Number.isInteger(nextQty) || nextQty < 1) return;
    if (mode === 'product') {
      if (!selected) return;
      onAdd({ productId: selected.id, qty: nextQty });
    } else {
      const cents = parseToCents(price);
      const trimmed = name.trim();
      if (!trimmed || cents === null) return;
      onAdd({ nameSnapshot: trimmed, unitPriceCents: cents, qty: nextQty });
    }
  }

  const canSubmit =
    mode === 'product'
      ? selected !== null
      : name.trim().length > 0 && parseToCents(price) !== null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-2 bg-surface-2 p-3">
      {/* Alternador produto / avulso */}
      <div className="flex gap-1 rounded-md bg-surface-3 p-0.5" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'product'}
          onClick={() => setMode('product')}
          className={cn(
            'flex-1 rounded-sm px-2 py-1.5 font-body text-xs font-medium outline-none transition-colors focus-visible:shadow-glow-md',
            mode === 'product' ? 'bg-surface text-text shadow-sm' : 'text-text-low hover:text-text',
          )}
        >
          Do catálogo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'adhoc'}
          onClick={() => {
            setMode('adhoc');
            setSelected(null);
          }}
          className={cn(
            'flex-1 rounded-sm px-2 py-1.5 font-body text-xs font-medium outline-none transition-colors focus-visible:shadow-glow-md',
            mode === 'adhoc' ? 'bg-surface text-text shadow-sm' : 'text-text-low hover:text-text',
          )}
        >
          Valor avulso
        </button>
      </div>

      {mode === 'product' ? (
        selected ? (
          <div className="flex items-center gap-2 rounded-md border border-border-2 bg-surface px-3 py-2">
            <Package className="size-4 shrink-0 text-text-low" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-sm font-medium text-text">{selected.name}</p>
              <p className="font-body text-xs text-text-low">
                {formatCents(selected.priceCents, selected.currency)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Trocar produto"
              className="flex size-11 items-center justify-center rounded-sm text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              label="Buscar produto"
              placeholder="Nome ou SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-44 overflow-y-auto rounded-md border border-border-2">
              {picker.isLoading ? (
                <div className="flex flex-col gap-1.5 p-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : picker.isError ? (
                <p className="px-3 py-4 text-center font-body text-xs text-text-low">
                  Falha ao buscar produtos.
                </p>
              ) : products.length === 0 ? (
                <p className="px-3 py-4 text-center font-body text-xs text-text-low">
                  {search.trim()
                    ? 'Nenhum produto encontrado. Use “Valor avulso”.'
                    : 'Catálogo vazio. Use “Valor avulso”.'}
                </p>
              ) : (
                <ul>
                  {products.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(p)}
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-md"
                      >
                        <span className="min-w-0 flex-1 truncate font-body text-sm text-text">
                          {p.name}
                        </span>
                        <span className="shrink-0 font-price text-xs text-text-mid">
                          {formatCents(p.priceCents, p.currency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            label="Descrição"
            placeholder="Ex.: Serviço de instalação"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Valor unitário (R$)"
            inputMode="decimal"
            placeholder="0,00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="w-20 shrink-0">
          <Input
            label="Qtd"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="primary"
          className="flex-1"
          loading={isPending}
          disabled={!canSubmit}
          leftIcon={<Plus className="size-3.5" aria-hidden />}
          onClick={submit}
        >
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ── Editor principal ──────────────────────────────────────────────────────────

export function DealItemsEditor({
  dealId,
  conversationId,
  canEdit,
}: {
  dealId: string;
  conversationId: string;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useDealItems(dealId);
  const addItem = useAddDealItem();

  const [adding, setAdding] = useState(false);

  function handleAdd(input: NewItemInput): void {
    if (addItem.isPending) return;
    addItem.mutate(
      { dealId, conversationId, ...input },
      {
        onSuccess: () => {
          toast({ title: 'Item adicionado', variant: 'success' });
          setAdding(false);
        },
        onError: () => toast({ title: 'Falha ao adicionar item', variant: 'error' }),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-3/4" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Não foi possível carregar os itens"
        reason="A consulta aos itens do card falhou."
        whatToDo="Verifique a conexão e tente novamente."
        action={
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const items = data.items;

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="font-body text-xs text-text-low">
          Nenhum item lançado. Vincule um produto ou lance um valor avulso.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <ItemRow
                item={item}
                dealId={dealId}
                conversationId={conversationId}
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      )}

      {canEdit &&
        (adding ? (
          <AddItemForm onAdd={handleAdd} isPending={addItem.isPending} onCancel={() => setAdding(false)} />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => setAdding(true)}
          >
            Adicionar item
          </Button>
        ))}
    </div>
  );
}
