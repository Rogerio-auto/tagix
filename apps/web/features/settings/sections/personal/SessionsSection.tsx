'use client';

import { useState } from 'react';
import { Button, Modal, useToast } from '@hm/ui';
import { useRevokeSession, useSessions } from './queries';

function dt(value: string | null): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

/** Sessões: lista devices logados + revogar (confirmação p/ ação crítica §5.1). */
export default function SessionsSection(): React.JSX.Element {
  const { toast } = useToast();
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

  if (sessionsQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-lg flex-col gap-2">
      {sessions.length === 0 && <p className="text-sm text-text-low">Nenhuma sessão ativa.</p>}
      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-text">
              {s.userAgent ?? 'Dispositivo desconhecido'}
              {s.current && <span className="ml-2 text-xs text-brand">(este dispositivo)</span>}
            </p>
            <p className="text-xs text-text-low">
              {s.ipAddress ?? '—'} · {dt(s.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmId(s.id)}
            className="text-xs text-text-low hover:text-danger"
          >
            Encerrar
          </button>
        </div>
      ))}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Encerrar sessão"
        description={
          confirmId === 'current'
            ? 'Isto encerra a sessão deste dispositivo e exige novo login.'
            : 'Isto encerra a sessão selecionada.'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={revoke.isPending}
              onClick={() => confirmId && void doRevoke(confirmId)}
            >
              {revoke.isPending ? 'Encerrando…' : 'Encerrar'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-mid">Tem certeza?</p>
      </Modal>
    </div>
  );
}
