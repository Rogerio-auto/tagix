'use client';

import { useState } from 'react';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Modal,
  useToast,
  type DataTableColumn,
} from '@hm/ui';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDateTime } from '@/shared/lib/locale';
import { useRevokeSession, useSessions, type SessionRow } from './queries';

/**
 * Sessões: devices logados + encerrar (confirmação proporcional, UX §2.9). Desktop em
 * `DataTable` (IP e data em mono); celular em cards. Segurança da PRÓPRIA conta: segue
 * liberada com a empresa em só leitura (o servidor isenta
 * `DELETE /api/members/me/sessions/:id`) — é também o caminho de saída.
 */
export default function SessionsSection(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const sessionsQuery = useSessions();
  const revoke = useRevokeSession();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const sessions = sessionsQuery.data?.sessions ?? [];

  const doRevoke = async (id: string) => {
    try {
      await revoke.mutateAsync(id);
      toast({ variant: 'success', title: 'Sessão encerrada.' });
      setConfirmId(null);
      // Revogar a sessão corrente derruba a auth — recarrega para o login.
      if (id === 'current') window.location.assign('/login');
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao revogar.' });
    }
  };

  const device = (s: SessionRow) => s.userAgent ?? 'Dispositivo desconhecido';

  const endButton = (s: SessionRow) => (
    <Button
      variant="ghost"
      size="sm"
      className="max-md:h-11"
      leftIcon={<LogOut className="size-4" aria-hidden />}
      aria-label={s.current ? 'Encerrar a sessão deste dispositivo' : `Encerrar sessão de ${device(s)}`}
      onClick={() => setConfirmId(s.id)}
    >
      Encerrar
    </Button>
  );

  const deviceCell = (s: SessionRow) => (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-text">{device(s)}</span>
      {s.current && (
        <Badge tone="brand" size="sm">
          Este dispositivo
        </Badge>
      )}
    </span>
  );

  const columns: DataTableColumn<SessionRow>[] = [
    { id: 'device', header: 'Dispositivo', cell: deviceCell },
    {
      id: 'ip',
      header: 'IP',
      width: '10rem',
      cell: (s) => <span className="font-mono text-sm tabular-nums text-text-mid">{s.ipAddress ?? '—'}</span>,
    },
    { id: 'createdAt', header: 'Início', numeric: true, width: '10rem', cell: (s) => formatDateTime(s.createdAt) },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '8rem',
      cell: endButton,
    },
  ];

  const cardColumns: readonly ResponsiveColumn<SessionRow>[] = [
    { id: 'device', card: 'primary', cell: device },
    {
      id: 'meta',
      card: 'secondary',
      cell: (s) => (
        <span className="font-mono tabular-nums">
          {s.ipAddress ?? '—'} · {formatDateTime(s.createdAt)}
        </span>
      ),
    },
    {
      id: 'current',
      card: 'badge',
      cell: (s) =>
        s.current ? (
          <Badge tone="brand" size="sm">
            Este dispositivo
          </Badge>
        ) : null,
    },
    { id: 'actions', card: 'meta', cell: endButton },
  ];

  const empty = {
    icon: MonitorSmartphone,
    title: 'Nenhuma sessão ativa',
    description: 'Quando você entrar em outro dispositivo, ele aparece aqui.',
  };
  const error = {
    title: 'Não foi possível carregar as sessões',
    reason: 'A lista de dispositivos não respondeu.',
    whatToDo: 'Tente de novo em instantes.',
    action: (
      <Button variant="secondary" loading={sessionsQuery.isFetching} onClick={() => void sessionsQuery.refetch()}>
        Tentar de novo
      </Button>
    ),
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-sm text-text-low">
        Encerre o acesso de um dispositivo que você não reconhece. Encerrar a sessão atual pede um novo login.
      </p>
      {isMobile ? (
        <ResponsiveTable<SessionRow>
          ariaLabel="Sessões ativas"
          rows={sessions}
          columns={cardColumns}
          getRowId={(s) => s.id}
          isLoading={sessionsQuery.isLoading}
          isError={sessionsQuery.isError}
          empty={empty}
          error={error}
          skeletonRows={3}
        />
      ) : (
        <DataTable<SessionRow>
          caption="Sessões ativas"
          columns={columns}
          rows={sessions}
          getRowId={(s) => s.id}
          loading={sessionsQuery.isLoading}
          loadingRows={3}
          error={sessionsQuery.isError ? <ErrorState {...error} /> : undefined}
          empty={<EmptyState {...empty} />}
        />
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Encerrar sessão"
        description={
          confirmId === 'current'
            ? 'Isto encerra a sessão deste dispositivo e exige novo login.'
            : 'O dispositivo selecionado perde o acesso e precisará entrar de novo.'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => confirmId && void doRevoke(confirmId)}>
              Encerrar sessão
            </Button>
          </div>
        }
      />
    </div>
  );
}
