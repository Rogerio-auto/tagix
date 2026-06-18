'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { useConversionTypes, useRegisterConversion } from './queries';

export interface MarkConversionModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string;
  conversationId?: string | null;
  dealId?: string | null;
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
  onRegistered,
}: MarkConversionModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const typesQuery = useConversionTypes();
  const register = useRegisterConversion();

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

  const selected = types.find((t) => t.id === typeId);

  async function submit(): Promise<void> {
    if (!selected) return;
    const valueCents = valueReais ? Math.round(Number(valueReais) * 100) : null;
    if (selected.valueRequired && (valueCents == null || Number.isNaN(valueCents))) {
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
        <label className="text-sm font-medium text-text" htmlFor="conv-type">
          Tipo de conversão
        </label>
        <select
          id="conv-type"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="touch-target rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:shadow-glow-md"
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
          <label className="text-sm font-medium text-text" htmlFor="conv-value">
            {selected?.valueLabel ?? 'Valor (R$)'}
            {selected?.valueRequired ? <span className="ml-1 text-danger">*</span> : null}
          </label>
          <Input
            id="conv-value"
            type="number"
            step="0.01"
            inputMode="decimal"
            value={valueReais}
            onChange={(e) => setValueReais(e.target.value)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text" htmlFor="conv-note">
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
          <Button
            variant="primary"
            className="w-full"
            disabled={!selected || register.isPending}
            loading={register.isPending}
            onClick={() => void submit()}
          >
            Registrar
          </Button>
        }
      >
        {fields}
      </Sheet>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Marcar conversão">
      <div className="flex flex-col gap-4">
        {fields}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!selected || register.isPending}
            onClick={() => void submit()}
          >
            {register.isPending ? 'Registrando…' : 'Registrar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
