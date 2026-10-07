'use client';

import { Copy, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, Skeleton } from '@hm/ui';
import { formatRelative } from '../time';
import { roleLabel, type PublicInvite } from '../types';

/** Ação de linha: 32 px no desktop (densidade), 44 px no toque (alvo mínimo mobile). */
const ROW_ACTION = 'max-md:h-11';

export type InviteRowAction = 'resend' | 'link' | 'revoke';

export interface PendingInvitesProps {
  isLoading: boolean;
  isError: boolean;
  invites: readonly PublicInvite[];
  /** Linha com ação em voo (um clique por vez em cada linha). */
  busy: { id: string; action: InviteRowAction } | null;
  now?: number;
  onRetry: () => void;
  onInvite: () => void;
  onResend: (invite: PublicInvite) => void;
  onCopyLink: (invite: PublicInvite) => void;
  onRevoke: (invite: PublicInvite) => void;
}

function InviteRow({
  invite,
  busy,
  now,
  onResend,
  onCopyLink,
  onRevoke,
}: Pick<PendingInvitesProps, 'busy' | 'now' | 'onResend' | 'onCopyLink' | 'onRevoke'> & {
  invite: PublicInvite;
}): React.JSX.Element {
  const rowBusy = busy?.id === invite.id ? busy.action : null;
  const anyBusy = busy !== null;
  const noResends = invite.resendsLeft <= 0;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface-2 text-text-low"
        >
          <Mail className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-body text-sm text-text">{invite.email}</p>
          <p className="truncate font-body text-xs text-text-low">
            {roleLabel(invite.role)} · enviado {formatRelative(invite.lastSentAt ?? invite.createdAt, now)} ·{' '}
            {invite.expired ? (
              // Ponto em `warn`, texto neutro: `text-warn` a 12 px dá 1,5:1 no tema claro.
              <span className="inline-flex items-center gap-1 font-semibold text-text">
                <span aria-hidden className="size-1.5 rounded-pill bg-warn" />
                expirado
              </span>
            ) : (
              <>expira {formatRelative(invite.expiresAt, now)}</>
            )}
          </p>
        </div>
      </div>
      {/* Mobile: `-ml-3` alinha o ícone do 1º botão fantasma à borda do conteúdo, e
          "Revogar" vira só o ícone (o nome acessível segue completo) para as três ações
          caberem numa linha a 375 px em vez de quebrar a destrutiva sozinha embaixo. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 max-sm:-ml-3 sm:justify-end">
        <Button
          size="sm"
          variant="ghost"
          className={ROW_ACTION}
          leftIcon={<RefreshCw className="size-3.5" aria-hidden />}
          loading={rowBusy === 'resend'}
          disabled={anyBusy || noResends}
          title={noResends ? 'Limite de reenvios atingido: copie o link' : undefined}
          aria-label={`Reenviar convite para ${invite.email}`}
          onClick={() => onResend(invite)}
        >
          Reenviar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={ROW_ACTION}
          leftIcon={<Copy className="size-3.5" aria-hidden />}
          loading={rowBusy === 'link'}
          disabled={anyBusy}
          aria-label={`Copiar link do convite de ${invite.email}`}
          onClick={() => onCopyLink(invite)}
        >
          Copiar link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`${ROW_ACTION} hover:text-danger max-sm:w-11 max-sm:px-0`}
          leftIcon={<Trash2 className="size-3.5 text-danger" aria-hidden />}
          loading={rowBusy === 'revoke'}
          disabled={anyBusy}
          aria-label={`Revogar convite de ${invite.email}`}
          onClick={() => onRevoke(invite)}
        >
          <span className="max-sm:sr-only">Revogar</span>
        </Button>
      </div>
    </li>
  );
}

/** Convites pendentes: vazio, carregando, erro e lista (UX §2.6/§2.7/§2.11). */
export function PendingInvites(props: PendingInvitesProps): React.JSX.Element {
  const { isLoading, isError, invites, busy, now, onRetry, onInvite, onResend, onCopyLink, onRevoke } =
    props;

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Carregando convites" className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-border">
        <ErrorState
          className="py-8"
          title="Não foi possível carregar os convites"
          reason="A lista de convites pendentes não respondeu."
          whatToDo="Tente de novo. Os membros abaixo não foram afetados."
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  if (invites.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border">
        <EmptyState
          className="py-8"
          icon={Mail}
          title="Nenhum convite pendente"
          description="Convide pessoas por email. Elas entram na equipe com o papel que você escolher."
          action={
            <Button variant="secondary" size="sm" onClick={onInvite}>
              Convidar membro
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {invites.map((invite) => (
        <InviteRow
          key={invite.id}
          invite={invite}
          busy={busy}
          now={now}
          onResend={onResend}
          onCopyLink={onCopyLink}
          onRevoke={onRevoke}
        />
      ))}
    </ul>
  );
}
