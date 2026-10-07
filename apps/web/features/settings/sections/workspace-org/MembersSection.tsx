'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, UserPlus, Users } from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, Modal, Skeleton, useToast } from '@hm/ui';
import { ROLES } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import {
  describeInviteError,
  runCopyLink,
  runResend,
  runRevoke,
  type Outcome,
} from '@/features/invites/actions';
import { invitesApi } from '@/features/invites/api';
import { InviteDialog } from '@/features/invites/components/InviteDialog';
import {
  PendingInvites,
  type InviteRowAction,
} from '@/features/invites/components/PendingInvites';
import { useInvites } from '@/features/invites/queries';
import { roleLabel, type PublicInvite } from '@/features/invites/types';
import { useQueryClient } from '@tanstack/react-query';
import { Toggle } from '../personal/components';
import { selectClass } from '../personal/components';
import {
  useDepartments,
  useMembers,
  useRemoveMember,
  useUpdateMember,
  type Member,
} from './queries';

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Removido',
  blocked: 'Bloqueado',
  invited: 'Convite pendente',
};

/**
 * Cor do status vive no PONTO, não no texto: os tons de status do DS (`--success`,
 * `--warn`, `--danger`) não mudam no tema claro e, como texto de 12 px, ficam entre
 * 1,3:1 e 3:1 sobre fundo claro. Rótulo neutro (≥7:1) + ponto colorido (marca não
 * textual) passa nos dois temas sem hex novo.
 */
const STATUS_DOT: Record<string, string> = {
  active: 'bg-success',
  inactive: 'bg-text-low',
  blocked: 'bg-danger',
  invited: 'bg-warn',
};

/** Rótulo legível do status — nunca o valor cru da API (`inactive` vira "Removido"). */
export function memberStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border bg-surface-2 px-2 py-0.5 font-head text-xs font-medium text-text-mid">
      <span aria-hidden className={cn('size-1.5 rounded-pill', STATUS_DOT[status] ?? 'bg-text-low')} />
      {memberStatusLabel(status)}
    </span>
  );
}

/** Estado do limite de vagas: ocupado e teto (null = ilimitado). */
function SeatSummary({ used, limit }: { used: number; limit: number | null }): React.JSX.Element {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="font-body text-sm text-text-mid">
        <span className="font-price font-semibold text-text">{used}</span>
        {limit === null ? ' vagas em uso · plano sem limite' : ` de ${limit} vagas em uso`}
      </p>
      {limit !== null && (
        <div
          role="progressbar"
          aria-label="Vagas em uso"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="h-1 w-40 max-w-full overflow-hidden rounded-pill bg-surface-3"
        >
          <div
            className={cn('h-full rounded-pill', full ? 'bg-warn' : 'bg-text-mid')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Membros e convites. Convida por email (link único), mostra os convites pendentes
 * com Reenviar / Copiar link / Revogar, lista membros com status legível e reativa
 * quem foi removido (sujeito ao limite de vagas).
 */
export default function MembersSection(): React.JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const myRole = useAuthStore((s) => s.auth?.role);
  const membersQuery = useMembers();
  const invitesQuery = useInvites();
  const departmentsQuery = useDepartments();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: InviteRowAction } | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState<Outcome | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PublicInvite | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const members = membersQuery.data?.members ?? [];
  const invites = invitesQuery.data?.invites ?? [];
  const seats = invitesQuery.data?.seats;
  const visibleMembers = showRemoved ? members : members.filter((m) => m.status !== 'inactive');
  const removedCount = members.length - members.filter((m) => m.status !== 'inactive').length;

  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: ['members'] });

  const announce = (o: Outcome) => {
    if (o.billingCta) {
      setLimitNotice(o);
      return;
    }
    setLimitNotice(null);
    toast({ variant: o.variant, title: o.title, ...(o.description ? { description: o.description } : {}) });
  };

  const openInvite = (email = '') => {
    setInviteEmail(email);
    setLimitNotice(null);
    setInviteOpen(true);
  };

  const onResend = async (invite: PublicInvite) => {
    setBusy({ id: invite.id, action: 'resend' });
    announce(await runResend(invitesApi, invite.id, invite.email));
    refreshAll();
    setBusy(null);
  };

  const onCopyLink = async (invite: PublicInvite) => {
    setBusy({ id: invite.id, action: 'link' });
    const clip = typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null;
    const res = await runCopyLink(invitesApi, clip, invite.id);
    announce(res.outcome);
    if (res.manualUrl) setManualLink(res.manualUrl);
    refreshAll();
    setBusy(null);
  };

  const onConfirmRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setBusy({ id: target.id, action: 'revoke' });
    announce(await runRevoke(invitesApi, target.id, target.email));
    setRevokeTarget(null);
    refreshAll();
    setBusy(null);
  };

  const changeRole = async (m: Member, nextRole: string) => {
    try {
      await updateMember.mutateAsync({ id: m.id, role: nextRole });
      toast({ variant: 'success', title: 'Papel atualizado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao atualizar.' });
    }
  };

  const reactivate = async (m: Member) => {
    setReactivatingId(m.id);
    try {
      await updateMember.mutateAsync({ id: m.id, status: 'active' });
      setLimitNotice(null);
      toast({ variant: 'success', title: `${m.name ?? m.email} voltou para a equipe.` });
    } catch (err) {
      announce(describeInviteError(err, 'reactivate'));
    } finally {
      setReactivatingId(null);
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

  if (membersQuery.isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Carregando membros" className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  if (membersQuery.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os membros"
        reason="A lista de membros não respondeu."
        whatToDo="Tente de novo em instantes."
        action={
          <Button variant="secondary" onClick={() => void membersQuery.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {seats ? <SeatSummary used={seats.used} limit={seats.limit} /> : <span />}
        <Button variant="primary" leftIcon={<UserPlus className="size-4" aria-hidden />} onClick={() => openInvite()}>
          Convidar membro
        </Button>
      </div>

      {limitNotice && (
        <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-head text-sm font-semibold text-text">{limitNotice.title}</p>
            {limitNotice.description && (
              <p className="font-body text-sm text-text-mid">{limitNotice.description}</p>
            )}
            <Link
              href="/settings/billing"
              className="mt-1 w-fit rounded-sm font-head text-sm font-semibold text-text underline underline-offset-4 outline-none focus-visible:shadow-glow-md"
            >
              Ver planos
            </Link>
          </div>
        </div>
      )}

      <section aria-labelledby="pending-invites-title" className="flex flex-col gap-3">
        <h3 id="pending-invites-title" className="font-head text-sm font-semibold text-text">
          Convites pendentes
          {invites.length > 0 && <span className="ml-2 font-price text-text-low">{invites.length}</span>}
        </h3>
        <PendingInvites
          isLoading={invitesQuery.isLoading}
          isError={invitesQuery.isError}
          invites={invites}
          busy={busy}
          onRetry={() => void invitesQuery.refetch()}
          onInvite={() => openInvite()}
          onResend={(i) => void onResend(i)}
          onCopyLink={(i) => void onCopyLink(i)}
          onRevoke={setRevokeTarget}
        />
      </section>

      <section aria-labelledby="members-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="members-title" className="font-head text-sm font-semibold text-text">
            Membros
            <span className="ml-2 font-price text-text-low">{visibleMembers.length}</span>
          </h3>
          {removedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-mid">
              <Toggle checked={showRemoved} onChange={setShowRemoved} label="Mostrar removidos" />
              Mostrar removidos ({removedCount})
            </label>
          )}
        </div>

        {visibleMembers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border">
            <EmptyState
              className="py-8"
              icon={Users}
              title="Nenhum membro por aqui"
              description="Convide a primeira pessoa da equipe por email."
              action={
                <Button variant="secondary" size="sm" onClick={() => openInvite()}>
                  Convidar membro
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {visibleMembers.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-body text-sm text-text">{m.name ?? m.email}</p>
                    <StatusBadge status={m.status} />
                  </div>
                  <p className="truncate font-body text-xs text-text-low">
                    {m.email}
                    {m.status === 'invited' && m.legacyInvite ? ' · convite antigo, sem link ativo' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.status === 'inactive' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="max-md:h-11"
                      loading={reactivatingId === m.id}
                      disabled={!canEditRole(m) || reactivatingId !== null}
                      aria-label={`Reativar ${m.email}`}
                      onClick={() => void reactivate(m)}
                    >
                      Reativar
                    </Button>
                  ) : m.status === 'invited' ? (
                    m.legacyInvite && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="max-md:h-11"
                        onClick={() => openInvite(m.email)}
                      >
                        Convidar de novo
                      </Button>
                    )
                  ) : (
                    <>
                      <select
                        value={m.role}
                        disabled={!canEditRole(m) || updateMember.isPending}
                        onChange={(e) => void changeRole(m, e.target.value)}
                        aria-label={`Papel de ${m.email}`}
                        className={`${selectClass} max-md:h-11`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="hover:text-danger max-md:h-11"
                        disabled={!canEditRole(m)}
                        onClick={() => {
                          setRemoveTarget(m);
                          setConfirmText('');
                        }}
                      >
                        Remover
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        departments={(departmentsQuery.data?.departments ?? []).filter((d) => d.isActive === 'active')}
        initialEmail={inviteEmail}
        onDone={announce}
      />

      <Modal
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revogar convite"
        description={
          revokeTarget
            ? `O link enviado para ${revokeTarget.email} deixa de funcionar. Você pode convidar a pessoa de novo depois.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={busy?.action === 'revoke'} onClick={() => void onConfirmRevoke()}>
              Revogar convite
            </Button>
          </div>
        }
      />

      <Modal
        open={manualLink !== null}
        onClose={() => setManualLink(null)}
        title="Copie o link do convite"
        description="O navegador não deixou copiar automaticamente. Selecione e copie o link abaixo."
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setManualLink(null)}>
              Fechar
            </Button>
          </div>
        }
      >
        <Input
          readOnly
          aria-label="Link do convite"
          value={manualLink ?? ''}
          onFocus={(e) => e.currentTarget.select()}
        />
      </Modal>

      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remover membro"
        description="Esta ação desativa o acesso do membro ao workspace. Você pode reativar depois, se houver vaga."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== 'REMOVER'}
              loading={removeMember.isPending}
              onClick={() => void doRemove()}
            >
              Remover
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
