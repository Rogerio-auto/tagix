'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { useCreateContact, useUpdateContact } from './queries';
import { textareaClass } from './styles';
import type { Contact } from './types';

interface ContactFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Quando presente, edita; senão, cria. */
  contact?: Contact | null;
}

interface FormState {
  displayName: string;
  phone: string;
  email: string;
  source: string;
  notes: string;
}

function fromContact(c?: Contact | null): FormState {
  return {
    displayName: c?.displayName ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    source: c?.source ?? '',
    notes: c?.notes ?? '',
  };
}

/**
 * Form de criar/editar contato (Modal: criação é um passo curto e focado, UX §2.3).
 * Erro de validação inline no campo (§2.7); "Salvar" com loading e guarda de só leitura.
 */
export function ContactFormModal({ open, onClose, contact }: ContactFormModalProps): React.JSX.Element {
  const { toast } = useToast();
  const create = useCreateContact();
  const update = useUpdateContact();
  const [form, setForm] = useState<FormState>(fromContact(contact));
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const editing = contact != null;
  const readOnly = useIsReadOnly();

  useEffect(() => {
    if (open) {
      setForm(fromContact(contact));
      setNameError(undefined);
    }
  }, [open, contact]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void =>
    setForm((s) => ({ ...s, [k]: v }));

  const pending = create.isPending || update.isPending;

  const submit = async (): Promise<void> => {
    const name = form.displayName.trim();
    if (!name) {
      setNameError('Informe o nome do contato.');
      return;
    }
    const payload = {
      displayName: name,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      source: form.source.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing && contact) {
        await update.mutateAsync({ id: contact.id, patch: payload });
        toast({ variant: 'success', title: 'Contato atualizado.' });
      } else {
        await create.mutateAsync(payload);
        toast({ variant: 'success', title: 'Contato criado.' });
      }
      onClose();
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar contato' : 'Novo contato'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <ReadOnlyGuard>
            <Button variant="primary" loading={pending} onClick={() => void submit()}>
              Salvar
            </Button>
          </ReadOnlyGuard>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) void submit();
        }}
      >
        <Input
          label="Nome"
          value={form.displayName}
          onChange={(e) => {
            set('displayName', e.target.value);
            if (nameError) setNameError(undefined);
          }}
          placeholder="Nome do contato"
          error={nameError}
          autoComplete="off"
        />
        <Input
          label="Telefone"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="+55 11 90000-0000"
          className="font-mono tabular-nums"
        />
        <Input
          label="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          placeholder="contato@exemplo.com"
        />
        <Input
          label="Origem"
          value={form.source}
          onChange={(e) => set('source', e.target.value)}
          placeholder="manual, import, whatsapp…"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-notes" className="font-body text-sm font-bold text-text-mid">
            Notas
          </label>
          <textarea
            id="contact-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            className={textareaClass}
            placeholder="Observações internas"
          />
        </div>
        {/* Enter no último campo de texto envia o form (atalho natural, UX §2.10). */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
