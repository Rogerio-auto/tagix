'use client';

import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ROLES, type Role } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { FieldLabel, selectClass } from '../personal/components';
import {
  useInviteMember,
  useMembers,
  useRemoveMember,
  useUpdateMember,
  type Member,
} from './queries';

/** Membros: convidar + trocar role + remover (typing-to-confirm em remoção). */
export default function MembersSection(): React.JSX.Element {
  const { toast } = useToast();
  const myRole = useAuthStore((s) => s.auth?.role);
  const membersQuery = useMembers();
  const invite = useInviteMember();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('AGENT');

  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const members = membersQuery.data?.members ?? [];

  const doInvite = async () => {
    if (!email.trim()) {
      toast({ variant: 'error', title: 'E-mail obrigatório.' });
      return;
    }
    try {
      await invite.mutateAsync({ email: email.trim(), name: name.trim() || null, role });
      toast({ variant: 'success', title: 'Convite enviado.' });
      setInviteOpen(false);
      setEmail('');
      setName('');
      setRole('AGENT');
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao convidar.' });
    }
  };

  const changeRole = async (m: Member, nextRole: string) => {
    try {
      await updateMember.mutateAsync({ id: m.id, role: nextRole });
      toast({ variant: 'success', title: 'Papel atualizado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao atualizar.' });
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeMember.mutateAsync(removeTarget.id);
      toast({ variant: 'success', title: 'Membro removido.' });
      setRemoveTarget(null);
      setConfirmText('');
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao remover.' });
    }
  };

  // OWNER só pode ser gerido por OWNER (espelha o guard do backend).
  const canEditRole = (m: Member) =>
    myRole === 'OWNER' || (m.role !== 'OWNER' && myRole === 'ADMIN');

  if (membersQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          Convidar membro
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-text">{m.name ?? m.email}</p>
              <p className="truncate text-xs text-text-low">
                {m.email} · {m.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={m.role}
                disabled={!canEditRole(m) || updateMember.isPending}
                onChange={(e) => void changeRole(m, e.target.value)}
                aria-label={`Papel de ${m.email}`}
                className={selectClass}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canEditRole(m)}
                onClick={() => {
                  setRemoveTarget(m);
                  setConfirmText('');
                }}
                className="text-xs text-text-low hover:text-danger disabled:opacity-40"
              >
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Convidar membro"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={invite.isPending} onClick={() => void doInvite()}>
              {invite.isPending ? 'Enviando…' : 'Enviar convite'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FieldLabel label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Nome (opcional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Papel">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectClass}>
              {ROLES.filter((r) => myRole === 'OWNER' || r !== 'OWNER').map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FieldLabel>
        </div>
      </Modal>

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remover membro"
        description="Esta ação desativa o acesso do membro ao workspace."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={confirmText !== 'REMOVER' || removeMember.isPending}
              onClick={() => void doRemove()}
            >
              {removeMember.isPending ? 'Removendo…' : 'Remover'}
            </Button>
          </div>
        }
      >
        <p className="mb-2 text-sm text-text-mid">
          Digite <span className="font-semibold text-text">REMOVER</span> para confirmar a remoção de{' '}
          <span className="font-semibold text-text">{removeTarget?.email}</span>.
        </p>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="REMOVER" />
      </Modal>
    </div>
  );
}
