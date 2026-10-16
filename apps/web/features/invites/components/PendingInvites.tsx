'use client';

import { Copy, Mail, RefreshCw, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusPill,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
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

type RowProps = Pick<PendingInvitesProps, 'busy' | 'onResend' | 'onCopyLink' | 'onRevoke'> & {
  invite: PublicInvite;
};

/**
 * As três ações da linha. Todas escrevem (reenviar e revogar; "copiar link" gera um link
 * novo por POST), então com a empresa em só leitura ficam `aria-disabled` com a
 * explicação (F71-S17) — continuam focáveis e o clique não chama a API.
 */
function InviteActions({
  invite,
  busy,
  onResend,
  onCopyLink,
  onRevoke,
}: RowProps): React.JSX.Element {
  const rowBusy = busy?.id === invite.id ? busy.action : null;
  const anyBusy = busy !== null;
  const noResends = invite.resendsLeft <= 0;
  // As três ações com rótulo (como "Remover" em Membros); o nome acessível é o completo.
  return (
    // Mobile: `-ml-3` alinha o ícone do 1º botão fantasma à borda do conteúdo, e "Revogar"
    // vira só o ícone (o nome acessível segue completo) para as três ações caberem numa
    // linha a 375 px em vez de quebrar a destrutiva sozinha embaixo.
    <div className="flex shrink-0 flex-wrap items-center gap-1 max-sm:-ml-3 sm:justify-end lg:flex-nowrap">
      <ReadOnlyGuard>
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
      </ReadOnlyGuard>
      <ReadOnlyGuard>
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
      </ReadOnlyGuard>
      <ReadOnlyGuard>
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
      </ReadOnlyGuard>
    </div>
  );
}

/** Desktop: "em 6 dias" (o cabeçalho diz "Expira") ou o selo de vencido (texto, nunca só cor). */
function Expiry({ invite, now }: { invite: PublicInvite; now: number | undefined }): React.JSX.Element {
  if (invite.expired) {
    return (
      <StatusPill tone="warning" size="sm">
        expirado
      </StatusPill>
    );
  }
  return (
    <span className="whitespace-nowrap font-mono text-sm tabular-nums text-text-mid">
      {formatRelative(invite.expiresAt, now)}
    </span>
  );
}

/**
 * Celular: o e-mail ganha a largura toda; papel, envio e validade descem para a linha de
 * apoio (datas em mono). Vencido vira o selo ao lado do e-mail.
 */
function MobileRow({ invite, now, ...actions }: RowProps & { now: number | undefined }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-low"
        >
          <Mail className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-body text-sm font-semibold text-text">{invite.email}</span>
            {invite.expired && <Expiry invite={invite} now={now} />}
          </p>
          {/* Cada fragmento é indivisível: a linha quebra entre "· enviado …" e "· expira …",
              nunca no meio de "expira em 5 dias". */}
          <p className="font-body text-xs text-text-low">
            <span className="whitespace-nowrap">{roleLabel(invite.role)}</span>
            {' · '}
            <span className="whitespace-nowrap">
              enviado <span className="font-mono tabular-nums">{formatRelative(invite.lastSentAt ?? invite.createdAt, now)}</span>
            </span>
            {!invite.expired && (
              <>
                {' · '}
                <span className="whitespace-nowrap">
                  expira <span className="font-mono tabular-nums">{formatRelative(invite.expiresAt, now)}</span>
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      <InviteActions invite={invite} {...actions} />
    </li>
  );
}

/** Convites pendentes: vazio, carregando, erro e lista (UX §2.6/§2.7/§2.11). Desktop em `DataTable`. */
export function PendingInvites(props: PendingInvitesProps): React.JSX.Element {
  const { isLoading, isError, invites, busy, now, onRetry, onInvite, onResend, onCopyLink, onRevoke } = props;
  const { isMobile } = useBreakpoint();

  const errorState = (
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
  );
  const emptyState = (
    <EmptyState
      className="py-8"
      icon={Mail}
      title="Nenhum convite pendente"
      description="Convide pessoas por email. Elas entram na equipe com o papel que você escolher."
      action={
        <ReadOnlyGuard align="center">
          <Button variant="secondary" size="sm" onClick={onInvite}>
            Convidar membro
          </Button>
        </ReadOnlyGuard>
      }
    />
  );

  if (isMobile || isLoading) {
    if (isLoading) {
      return (
        <div role="status" aria-busy="true" aria-label="Carregando convites" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      );
    }
    if (isError) return <div className="rounded-lg border border-border bg-surface">{errorState}</div>;
    if (invites.length === 0) {
      return <div className="rounded-lg border border-dashed border-border-2">{emptyState}</div>;
    }
    return (
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {invites.map((invite) => (
          <MobileRow
            key={invite.id}
            invite={invite}
            now={now}
            busy={busy}
            onResend={onResend}
            onCopyLink={onCopyLink}
            onRevoke={onRevoke}
          />
        ))}
      </ul>
    );
  }

  const columns: DataTableColumn<PublicInvite>[] = [
    {
      id: 'email',
      header: 'Convidado',
      cell: (i) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-low"
          >
            <Mail className="size-4" />
          </span>
          {/* `w-0 flex-1`: sem largura mínima própria — a coluna do e-mail fica com o espaço que
              sobra das colunas fixas e trunca (com o e-mail inteiro na dica) em vez de empurrar a tabela.
              O envio desce como subtítulo (como no celular), liberando a largura das ações rotuladas. */}
          <span className="flex w-0 min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold text-text" title={i.email}>
              {i.email}
            </span>
            <span className="truncate font-body text-xs text-text-low">
              enviado{' '}
              <span className="font-mono tabular-nums">{formatRelative(i.lastSentAt ?? i.createdAt, now)}</span>
            </span>
          </span>
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Papel',
      width: '9rem',
      cell: (i) => <span className="whitespace-nowrap text-text-mid">{roleLabel(i.role)}</span>,
    },
    { id: 'expires', header: 'Expira', width: '7.5rem', cell: (i) => <Expiry invite={i} now={now} /> },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '19.5rem',
      cell: (i) => (
        <InviteActions
          invite={i}
          busy={busy}
          onResend={onResend}
          onCopyLink={onCopyLink}
          onRevoke={onRevoke}
        />
      ),
    },
  ];

  return (
    <DataTable<PublicInvite>
      caption="Convites pendentes"
      columns={columns}
      rows={invites}
      getRowId={(i) => i.id}
      density="compact"
      getRowState={(i) => (i.expired ? 'attention' : undefined)}
      error={isError ? errorState : undefined}
      empty={emptyState}
    />
  );
}
