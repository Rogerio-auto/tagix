'use client';

/**
 * Formulário de criar/editar produto (F47-S05), montado dentro do `ResponsivePanel`
 * (drawer no desktop, sheet no mobile — UX §2.3).
 *
 * - Feedback imediato no save (botão `loading`, UX §2.7) + toast de sucesso/erro.
 * - Inputs `size="lg"` (≥16px de fonte) p/ não disparar zoom no iOS (MOBILE_UX §8).
 * - 409 `duplicate_sku` da API vira erro inline no campo SKU (UX §2.11 — o quê +
 *   o que fazer), não um toast genérico.
 * - Verde-neon (brand) só no CTA primário "Salvar".
 * - Só leitura (F72-S07): o envio fica `aria-disabled` e o Enter não submete.
 */
import { useEffect, useState } from 'react';
import { Button, Input, Switch, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { ApiError } from '@/shared/lib/api-client';
import { useCreateProduct, useUpdateProduct } from './queries';
import { centsToInputValue, parseToCents } from './money';
import type { Product } from './types';

export interface ProductFormProps {
  /** Produto em edição; ausente = criação. */
  product?: Product;
  /** Fecha o painel após salvar com sucesso ou ao cancelar. */
  onDone: () => void;
}

export function ProductForm({ product, onDone }: ProductFormProps): React.JSX.Element {
  const { toast } = useToast();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const isEdit = product !== undefined;
  const readOnly = useIsReadOnly();

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [priceInput, setPriceInput] = useState(
    product ? centsToInputValue(product.priceCents) : '',
  );
  const [active, setActive] = useState(product?.active ?? true);
  const [skuError, setSkuError] = useState<string | undefined>(undefined);
  const [priceError, setPriceError] = useState<string | undefined>(undefined);

  // Reidrata os campos quando o produto-alvo troca sem desmontar o form.
  useEffect(() => {
    setName(product?.name ?? '');
    setSku(product?.sku ?? '');
    setDescription(product?.description ?? '');
    setPriceInput(product ? centsToInputValue(product.priceCents) : '');
    setActive(product?.active ?? true);
    setSkuError(undefined);
    setPriceError(undefined);
  }, [product]);

  const pending = create.isPending || update.isPending;
  const trimmedName = name.trim();

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (readOnly) return;
    setSkuError(undefined);
    setPriceError(undefined);

    if (!trimmedName) return;
    const priceCents = priceInput.trim() ? parseToCents(priceInput) : 0;
    if (priceCents === null) {
      setPriceError('Informe um valor válido. Ex.: 129,90');
      return;
    }

    const payload = {
      name: trimmedName,
      sku: sku.trim() || null,
      description: description.trim() || null,
      priceCents,
      active,
    };

    const onError = (err: Error): void => {
      if (err instanceof ApiError && err.status === 409) {
        setSkuError('Já existe um produto com esse SKU. Use outro código.');
        return;
      }
      toast({ variant: 'error', title: 'Falha ao salvar produto', description: err.message });
    };

    if (isEdit) {
      update.mutate(
        { id: product.id, patch: payload },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Produto atualizado' });
            onDone();
          },
          onError,
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast({ variant: 'success', title: 'Produto adicionado' });
          onDone();
        },
        onError,
      });
    }
  }

  return (
    <form id="product-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Input
        label="Nome"
        size="lg"
        value={name}
        autoFocus
        required
        placeholder="Ex.: Plano Premium anual"
        onChange={(e) => setName(e.target.value)}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Preço"
          size="lg"
          inputMode="decimal"
          className="font-mono tabular-nums"
          value={priceInput}
          placeholder="0,00"
          error={priceError}
          onChange={(e) => {
            setPriceInput(e.target.value);
            if (priceError) setPriceError(undefined);
          }}
        />
        <Input
          label="SKU (opcional)"
          size="lg"
          value={sku}
          placeholder="Ex.: PLN-PREM-12M"
          className="font-mono"
          error={skuError}
          onChange={(e) => {
            setSku(e.target.value);
            if (skuError) setSkuError(undefined);
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-desc" className="font-body text-sm font-bold text-text-mid">
          Descrição (opcional)
        </label>
        <textarea
          id="product-desc"
          value={description}
          rows={3}
          placeholder="Detalhes do produto, condições, observações."
          onChange={(e) => setDescription(e.target.value)}
          className="w-full resize-y rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none transition-[color,border-color,box-shadow] duration-(--dur-base) ease-ds placeholder:text-text-low hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring"
        />
      </div>

      <div className="rounded-md border border-border bg-surface-2 px-3.5 py-3">
        <Switch
          checked={active}
          onCheckedChange={setActive}
          label="Produto ativo"
          description="Produtos ativos ficam disponíveis para vincular a um card."
        />
      </div>

      {/* Ações na zona do polegar (rodapé do painel/sheet). */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <ReadOnlyGuard>
          <Button type="submit" variant="primary" loading={pending} disabled={!trimmedName}>
            {isEdit ? 'Salvar' : 'Adicionar produto'}
          </Button>
        </ReadOnlyGuard>
      </div>
    </form>
  );
}
