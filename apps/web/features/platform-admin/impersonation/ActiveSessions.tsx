'use client';

/**
 * Sessões view-as ativas (F26-S09) com kill-switch. Consome F26-S05.
 *
 * DS 3.0 (F72-S08): `DataTable` no desktop (workspace, início e expiração em mono),
 * cards no celular. "Encerrar" chama o MESMO `useEndImpersonation(id)` de antes, sem
 * confirmação (encerrar a própria sessão de leitura não apaga nada; era assim). O botão
 * mostra carregando só na linha em curso (UX §2.7).
 */
import { Eye, XCircle } from 'lucide-react';
import { Button, DataTable, EmptyState, ErrorState, Skeleton, type DataTableColumn } from '@hm/ui';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDateTime, formatNumber, formatTime } from '@/shared/lib/locale';
import { Count, Panel } from '../ui/kit';
import { useActiveSessions, useEndImpersonation, type ImpersonationSession } from './queries';

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

export function ActiveSessions() {
  const { isMobile } = useBreakpoint();
  const query = useActiveSessions();
  const end = useEndImpersonation();
  const sessions = query.data?.sessions ?? [];

  const endButton = (s: ImpersonationSession) => (
    <Button
      variant="danger"
      size="sm"
      className="max-md:h-11"
      loading={end.isPending && end.variables === s.id}
      disabled={end.isPending}
      leftIcon={<XCircle className="size-4" aria-hidden />}
      aria-label={`Encerrar a sessão no workspace ${s.targetWorkspaceId}`}
      onClick={() => end.mutate(s.id)}
    >
      Encerrar
    </Button>
  );

  const columns: DataTableColumn<ImpersonationSession>[] = [
    {
      id: 'workspace',
      header: 'Workspace',
      width: '16rem',
      cell: (s) => <span className="block truncate font-mono text-sm text-text">{s.targetWorkspaceId}</span>,
    },
    { id: 'reason', header: 'Motivo', cell: (s) => <span className="line-clamp-2 text-text-mid">{s.reason}</span> },
    {
      id: 'startedAt',
      header: 'Início',
      numeric: true,
      width: '10.5rem',
      cell: (s) => <span className="whitespace-nowrap text-text-mid">{formatDateTime(s.startedAt, DATE_TIME)}</span>,
    },
    {
      id: 'expiresAt',
      header: 'Expira',
      numeric: true,
      width: '6rem',
      cell: (s) => <span className="whitespace-nowrap text-text">{formatTime(s.expiresAt)}</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '8.5rem',
      cell: endButton,
    },
  ];

  const error = (
    <ErrorState
      title="Não foi possível carregar as sessões"
      reason="A lista de view-as ativos não respondeu."
      whatToDo="Tente de novo em instantes."
      action={
        <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );
  const empty = (
    <EmptyState
      className="py-10"
      icon={Eye}
      title="Nenhuma sessão ativa"
      description="Abra o 360 de um tenant e use “Ver como” para entrar em modo somente leitura."
    />
  );

  return (
    <Panel
      title="Sessões ativas"
      titleId="impersonation-active"
      description="Somente leitura e com prazo. Encerre quando terminar."
      body="flush"
      action={
        query.data ? <Count value={formatNumber(sessions.length)} label={`${sessions.length} sessões ativas`} /> : undefined
      }
    >
      {isMobile ? (
        query.isLoading ? (
          <div role="status" aria-busy="true" aria-label="Carregando sessões" className="flex flex-col gap-2 p-4">
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
          </div>
        ) : query.isError ? (
          error
        ) : sessions.length === 0 ? (
          empty
        ) : (
          <ul aria-label="Sessões ativas" className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 px-5 py-4">
                <span className="truncate font-mono text-sm text-text">{s.targetWorkspaceId}</span>
                <span className="font-body text-sm text-text-mid">{s.reason}</span>
                <span className="font-mono text-xs tabular-nums text-text-low">
                  {formatDateTime(s.startedAt, DATE_TIME)} → {formatTime(s.expiresAt)}
                </span>
                <span>{endButton(s)}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <DataTable<ImpersonationSession>
          caption="Sessões view-as ativas"
          columns={columns}
          rows={sessions}
          getRowId={(s) => s.id}
          density="compact"
          loading={query.isLoading}
          loadingRows={3}
          error={query.isError ? error : undefined}
          empty={empty}
          className="rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)] border-0"
        />
      )}
    </Panel>
  );
}
