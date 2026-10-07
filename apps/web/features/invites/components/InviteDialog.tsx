'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { z } from 'zod';
import { Button, Input, Modal } from '@hm/ui';
import { describeInviteError, outcomeForDelivery, type Outcome } from '../actions';
import { useCreateInvite } from '../queries';
import { INVITABLE_ROLES, ROLE_HINTS, roleLabel, type InvitableRole } from '../types';

const emailSchema = z.string().trim().toLowerCase().email();

const fieldClass =
  'h-11 md:h-10 w-full rounded-sm border border-border bg-surface-inset px-3 font-body text-sm text-text outline-none transition-[border-color,box-shadow] duration-200 hover:border-border-2 focus:border-brand focus:shadow-glow-sm';

export interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  departments: ReadonlyArray<{ id: string; name: string }>;
  /** Email pré-preenchido (convite legado → convidar de novo). */
  initialEmail?: string;
  /** Chamado com o resultado (toast de sucesso/aviso) quando o convite foi criado. */
  onDone: (outcome: Outcome) => void;
}

/**
 * Convidar membro. Modal porque é um formulário curto e bloqueante (UX §2.3: Modal é
 * para confirmação/wizard). OWNER nunca aparece nos papéis. Erros em 3 partes dentro
 * do próprio modal (no mobile o toast pode ficar atrás do teclado); limite de vagas
 * oferece o CTA para o plano.
 */
export function InviteDialog({
  open,
  onClose,
  departments,
  initialEmail = '',
  onDone,
}: InviteDialogProps): React.JSX.Element {
  const create = useCreateInvite();
  const [email, setEmail] = useState(initialEmail);
  const [role, setRole] = useState<InvitableRole>('AGENT');
  const [departmentId, setDepartmentId] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [failure, setFailure] = useState<Outcome | null>(null);

  // Reabre limpo (ou pré-preenchido pelo convite legado).
  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    setRole('AGENT');
    setDepartmentId('');
    setEmailError(undefined);
    setFailure(null);
  }, [open, initialEmail]);

  const submit = async () => {
    setFailure(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError('Informe um email válido');
      return;
    }
    setEmailError(undefined);
    try {
      const res = await create.mutateAsync({
        email: parsed.data,
        role,
        ...(departmentId ? { departmentId } : {}),
      });
      onDone(outcomeForDelivery(res.delivery, res.invite.email, res.resent === true));
      onClose();
    } catch (err) {
      setFailure(describeInviteError(err, 'create'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convidar membro"
      description="Enviamos um link por email. Ele vale por alguns dias e só funciona uma vez."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => void submit()}>
            Enviar convite
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {failure && (
          <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="font-head text-sm font-semibold text-text">{failure.title}</p>
              {failure.description && (
                <p className="font-body text-sm text-text-mid">{failure.description}</p>
              )}
              {failure.billingCta && (
                <Link
                  href="/settings/billing"
                  className="mt-1 w-fit rounded-sm font-head text-sm font-semibold text-text underline underline-offset-4 outline-none focus-visible:shadow-glow-md"
                >
                  Ver planos
                </Link>
              )}
            </div>
          </div>
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          placeholder="pessoa@empresa.com"
          // Mesma altura do <select> abaixo: 44 px no toque, 40 px no desktop.
          className="max-md:h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="font-head text-sm font-medium text-text-mid">
            Papel
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            className={fieldClass}
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <p className="font-body text-xs text-text-low">{ROLE_HINTS[role]}</p>
        </div>
        {departments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-dept" className="font-head text-sm font-medium text-text-mid">
              Departamento <span className="font-normal text-text-low">(opcional)</span>
            </label>
            <select
              id="invite-dept"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Sem departamento</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Enter envia: o botão do rodapé fica fora do <form>. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          Enviar
        </button>
      </form>
    </Modal>
  );
}
