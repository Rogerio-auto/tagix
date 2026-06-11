'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { useCreateContact, useUpdateContact } from './queries';
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

/** Form de criar/editar contato. */
export function ContactFormModal({ open, onClose, contact }: ContactFormModalProps): React.JSX.Element {
  const { toast } = useToast();
  const create = useCreateContact();
  const update = useUpdateContact();
  const [form, setForm] = useState<FormState>(fromContact(contact));
  const editing = contact != null;

  useEffect(() => {
    if (open) setForm(fromContact(contact));
  }, [open, contact]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const pending = create.isPending || update.isPending;

  const submit = async () => {
    const name = form.displayName.trim();
    if (!name) {
      toast({ variant: 'error', title: 'Nome é obrigatório.' });
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
          <Button variant="primary" onClick={() => void submit()} disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-text-mid">
          Nome
          <Input
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="Nome do contato"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-mid">
          Telefone
          <Input
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+55 11 90000-0000"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-mid">
          E-mail
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="contato@exemplo.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-mid">
          Origem
          <Input
            value={form.source}
            onChange={(e) => set('source', e.target.value)}
            placeholder="manual, import, whatsapp…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-mid">
          Notas
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md"
            placeholder="Observações internas"
          />
        </label>
      </div>
    </Modal>
  );
}
