'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, UserPlus, Users } from 'lucide-react';
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  StatusPill,
  useToast,
  type BadgeTone,
  type DataTableColumn,
} from '@hm/ui';
import { ROLES } from '@hm/shared';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
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
import { PendingInvites, type InviteRowAction } from '@/features/invites/components/PendingInvites';
import { useInvites } from '@/features/invites/queries';
import { roleLabel, type PublicInvite } from '@/features/invites/types';
import { useQueryClient } from '@tanstack/react-query';
import { Toggle, eyebrowClass, selectClass } from '../personal/components';
import { useDepartments, useMembers, useRemoveMember, useUpdateMember, type Member } from './queries';

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Removido',
  blocked: 'Bloqueado',
  invited: 'Convite pendente',
};

/**
 * Tom do status (DS 3.0): os tons de estado do S01 têm variante própria no tema claro
 * (≥4,5:1), então o selo leva texto + ponto na cor do estado. O significado nunca é só a
 * cor: o rótulo está sempre presente.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  inactive: 'neutral',
  blocked: 'danger',
  invited: 'warning',
};

/** Rótulo legível do status — nunca o valor cru da API (`inactive` vira "Removido"). */
export function memberStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <StatusPill tone={STATUS_TONE[status] ?? 'neutral'} size="sm">
      {memberStatusLabel(status)}
    </StatusPill>
  );
}

/** Estado do limite de vagas: ocupado e teto (null = ilimitado). Números em mono. */
function SeatSummary({ used, limit }: { used: number; limit: number | null }): React.JSX.Element {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className={eyebrowClass}>Vagas</p>
      <p className="font-body text-sm text-text-mid">
        <span className="font-mono text-base font-semibold tabular-nums text-text">{formatNumber(used)}</span>
        {limit === null ? ' vagas em uso · plano sem limite' : ` de ${formatNumber(limit)} vagas em uso`}
      </p>
      {limit !== null && (
        <div
          role="progressbar"
          aria-label="Vagas em uso"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          className="h-1 w-48 max-w-full overflow-hidden rounded-pill bg-surface-3"
        >
          <div
            className={cn(
              'h-full rounded-pill motion-safe:transition-[width] motion-safe:duration-(--dur-slow) motion-safe:ease-ds',
              full ? 'bg-warn' : 'bg-brand-text',
            )}
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
 *
 * DS 3.0 (F72-S07): desktop em `DataTable` (papel editável na linha, status em selo),
 * celular em cards. Só leitura (F71-S17): convidar, mudar papel, remover, reativar e as
 * ações dos convites ficam `aria-disabled` com a explicação; o filtro "Mostrar removidos"
 * é só visualização e segue livre.
 */
export default function MembersSection(): React.JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const myRole = useAuthStore((s) => s.auth?.role);
  const readOnly = useIsReadOnly();
  const { isMobile } = useBreakpoint();
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
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
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
    if (readOnly) return;
    setRoleChangingId(m.id);
    try {
      await updateMember.mutateAsync({ id: m.id, role: nextRole });
      toast({ variant: 'success', title: 'Papel atualizado.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao atualizar.' });
    } finally {
      setRoleChangingId(null);
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
  const canEditRole = (m: Member) => myRole === 'OWNER' || (m.role !== 'OWNER' && myRole === 'ADMIN');

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
          <Button variant="secondary" loading={membersQuery.isFetching} onClick={() => void membersQuery.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const inviteButton = (
    <ReadOnlyGuard>
      <Button variant="primary" leftIcon={<UserPlus className="size-4" aria-hidden />} onClick={() => openInvite()}>
        Convidar membro
      </Button>
    </ReadOnlyGuard>
  );

  /** Papel: select na linha. Em só leitura fica `aria-disabled` (focável) e ignora a troca. */
  const roleControl = (m: Member) => (
    <ReadOnlyGuard align="start">
      <select
        value={m.role}
        disabled={!canEditRole(m) || roleChangingId !== null}
        aria-busy={roleChangingId === m.id || undefined}
        onMouseDown={readOnly ? (e) => e.preventDefault() : undefined}
        onChange={(e) => void changeRole(m, e.target.value)}
        aria-label={`Papel de ${m.email}`}
        className={cn(selectClass, 'max-md:h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50')}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
    </ReadOnlyGuard>
  );

  const rowActions = (m: Member) => {
    if (m.status === 'inactive') {
      return (
        <ReadOnlyGuard>
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
        </ReadOnlyGuard>
      );
    }
    if (m.status === 'invited') {
      return m.legacyInvite ? (
        <ReadOnlyGuard>
          <Button size="sm" variant="secondary" className="max-md:h-11" onClick={() => openInvite(m.email)}>
            Convidar de novo
          </Button>
        </ReadOnlyGuard>
      ) : null;
    }
    return (
      <ReadOnlyGuard>
        <Button
          size="sm"
          variant="ghost"
          className="hover:text-danger max-md:h-11"
          disabled={!canEditRole(m)}
          aria-label={`Remover ${m.email}`}
          onClick={() => {
            setRemoveTarget(m);
            setConfirmText('');
          }}
        >
          Remover
        </Button>
      </ReadOnlyGuard>
    );
  };

  const identity = (m: Member) => (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={m.name ?? m.email} src={m.avatarUrl} size="md" className="size-9" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-body text-sm font-semibold text-text">{m.name ?? m.email}</span>
        <span className="truncate font-body text-xs text-text-low">
          {m.email}
          {m.status === 'invited' && m.legacyInvite ? ' · convite antigo, sem link ativo' : ''}
        </span>
      </span>
    </span>
  );

  const columns: DataTableColumn<Member>[] = [
    { id: 'member', header: 'Membro', cell: identity },
    {
      id: 'role',
      header: 'Papel',
      width: '12rem',
      cell: (m) =>
        m.status === 'active' || m.status === 'blocked' ? (
          roleControl(m)
        ) : (
          <span className="text-text-mid">{roleLabel(m.role)}</span>
        ),
    },
    { id: 'status', header: 'Status', width: '10rem', cell: (m) => <StatusBadge status={m.status} /> },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '10rem',
      cell: rowActions,
    },
  ];

  const membersEmpty = (
    <EmptyState
      className="py-8"
      icon={Users}
      title="Nenhum membro por aqui"
      description="Convide a primeira pessoa da equipe por email."
      action={
        <ReadOnlyGuard align="center">
          <Button variant="secondary" size="sm" onClick={() => openInvite()}>
            Convidar membro
          </Button>
        </ReadOnlyGuard>
      }
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-surface px-5 py-4">
        {seats ? <SeatSummary used={seats.used} limit={seats.limit} /> : <span />}
        {inviteButton}
      </div>

      {limitNotice && (
        <div role="alert" className="flex gap-3 rounded-md border border-danger/30 bg-danger/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-body text-sm font-bold text-text">{limitNotice.title}</p>
            {limitNotice.description && <p className="font-body text-sm text-text-mid">{limitNotice.description}</p>}
            <Link
              href="/settings/billing"
              className="mt-1 w-fit rounded-xs font-body text-sm font-bold text-text underline underline-offset-4 outline-none focus-visible:focus-ring"
            >
              Ver planos
            </Link>
          </div>
        </div>
      )}

      <section aria-labelledby="pending-invites-title" className="flex flex-col gap-3">
        <h3 id="pending-invites-title" className="flex items-baseline gap-2 font-head text-base font-semibold text-text">
          Convites pendentes
          {invites.length > 0 && (
            <span className="font-mono text-sm font-medium tabular-nums text-text-low">{formatNumber(invites.length)}</span>
          )}
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
          <h3 id="members-title" className="flex items-baseline gap-2 font-head text-base font-semibold text-text">
            Membros
            <span className="font-mono text-sm font-medium tabular-nums text-text-low">
              {formatNumber(visibleMembers.length)}
            </span>
          </h3>
          {removedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-mid">
              <Toggle checked={showRemoved} onChange={setShowRemoved} label="Mostrar removidos" />
              Mostrar removidos ({removedCount})
            </label>
          )}
        </div>

        {isMobile ? (
          visibleMembers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-2">{membersEmpty}</div>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
              {visibleMembers.map((m) => (
                <li key={m.id} className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    {identity(m)}
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(m.status === 'active' || m.status === 'blocked') && roleControl(m)}
                    {rowActions(m)}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <DataTable<Member>
            caption="Membros"
            columns={columns}
            rows={visibleMembers}
            getRowId={(m) => m.id}
            density="compact"
            getRowState={(m) => (m.status === 'inactive' ? 'muted' : undefined)}
            empty={membersEmpty}
          />
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
          className="font-mono"
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
        <p className="mb-3 text-sm text-text-mid">
          Digite <span className="font-mono font-semibold text-text">REMOVER</span> para confirmar a remoção de{' '}
          <span className="font-semibold text-text">{removeTarget?.email}</span>.
        </p>
        <Input
          aria-label="Confirmação da remoção"
          className="font-mono"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="REMOVER"
        />
      </Modal>
    </div>
  );
}
