'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { parseToCents } from '@/features/products/money';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { centsToInput } from '@/shared/lib/locale';
import { useConversionTypes, useRegisterConversion } from './queries';

export interface MarkConversionModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string;
  conversationId?: string | null;
  dealId?: string | null;
  /**
   * Valor (em centavos) herdado do card/deal (F47-S08). Quando informado e o
   * modal abre, pré-preenche o campo de valor (convertido para reais) — sem
   * travar a edição. `undefined`/`null` = comportamento original (campo vazio).
   */
  valueCents?: number | null;
  onRegistered?: () => void;
}

/**
 * Marcação de conversão (F5-S13, DASHBOARD §13). Tipo default pré-selecionado,
 * valor obrigatório quando o tipo pede, dedup 409 → mensagem amigável.
 * Responsiva (F36-S10): `Modal` em md+, `Sheet` (bottom) com CTA fixo na zona do
 * polegar no mobile. Inputs 16px herdados do globals.css.
 */
export function MarkConversionModal({
  open,
  onClose,
  contactId,
  conversationId,
  dealId,
  valueCents,
  onRegistered,
}: MarkConversionModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const typesQuery = useConversionTypes();
  const register = useRegisterConversion();
  const readOnly = useIsReadOnly();

  const types = useMemo(
    () => (typesQuery.data?.conversionTypes ?? []).filter((t) => t.isActive),
    [typesQuery.data],
  );
  const [typeId, setTypeId] = useState<string>('');
  const [valueReais, setValueReais] = useState<string>('');
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    if (!typeId && types.length > 0) {
      setTypeId((types.find((t) => t.isDefault) ?? types[0]!).id);
    }
  }, [types, typeId]);

  // Valor herdado do card (F47-S08): ao abrir, pré-preenche o campo de valor em
  // reais. Não trava a edição — o usuário pode sobrescrever livremente.
  useEffect(() => {
    if (open && valueCents != null && valueCents > 0) {
      setValueReais(centsToInput(valueCents));
    }
  }, [open, valueCents]);

  const selected = types.find((t) => t.id === typeId);

  async function submit(): Promise<void> {
    if (!selected || readOnly) return;
    const valueCents = valueReais ? parseToCents(valueReais) : null;
    if (selected.valueRequired && valueCents == null) {
      toast({ variant: 'warn', title: 'Informe o valor desta conversão.' });
      return;
    }
    try {
      await register.mutateAsync({
        conversionTypeId: selected.id,
        contactId,
        conversationId: conversationId ?? null,
        dealId: dealId ?? null,
        valueCents,
        note: note || null,
        source: 'manual',
      });
      toast({ variant: 'success', title: 'Conversão registrada.' });
      onRegistered?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast({ variant: 'warn', title: 'Esta conversão já foi registrada hoje para este contato.' });
        return;
      }
      toast({
        variant: 'error',
        title: err instanceof ApiError ? err.message : 'Não foi possível registrar a conversão.',
      });
    }
  }

  const fields: ReactNode = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="font-body text-sm font-bold text-text-mid" htmlFor="conv-type">
          Tipo de conversão
        </label>
        <select
          id="conv-type"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="h-11 rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 focus:border-brand-text focus-visible:focus-ring sm:text-sm"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {selected?.valueRequired || valueReais ? (
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-sm font-bold text-text-mid" htmlFor="conv-value">
            {selected?.valueLabel ?? 'Valor'}
            {selected?.currency ? (
              <span className="ml-1.5 font-mono text-xs font-medium text-text-low">{selected.currency}</span>
            ) : null}
            {selected?.valueRequired ? (
              <span className="ml-1 text-danger" aria-hidden>
                *
              </span>
            ) : null}
          </label>
          <Input
            id="conv-value"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            required={selected?.valueRequired}
            value={valueReais}
            onChange={(e) => setValueReais(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="font-body text-sm font-bold text-text-mid" htmlFor="conv-note">
          Observação (opcional)
        </label>
        <Input id="conv-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        variant="bottom"
        title="Marcar conversão"
        footer={
          <ReadOnlyGuard className="w-full" align="center">
            <Button
              variant="primary"
              className="w-full"
              disabled={!selected}
              loading={register.isPending}
              onClick={() => void submit()}
            >
              Registrar
            </Button>
          </ReadOnlyGuard>
        }
      >
        {fields}
      </Sheet>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Marcar conversão"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={register.isPending}>
            Cancelar
          </Button>
          <ReadOnlyGuard>
            <Button
              variant="primary"
              disabled={!selected}
              loading={register.isPending}
              onClick={() => void submit()}
            >
              Registrar
            </Button>
          </ReadOnlyGuard>
        </>
      }
    >
      {fields}
    </Modal>
  );
}
