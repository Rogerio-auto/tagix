'use client';

/**
 * Botao "Ver como" (F26-S09) -- abre modal de motivo (LGPD: reason obrigatorio),
 * inicia a sessao view-as READ-ONLY e leva ao app de workspace no contexto do tenant.
 * Consome F26-S05. DS v2 dark-first.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import { useStartImpersonation } from './queries';

export function ViewAsButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const start = useStartImpersonation();
  const router = useRouter();

  async function confirm() {
    setError(null);
    if (reason.trim().length < 5) {
      setError('Informe um motivo (minimo 5 caracteres) -- exigencia de auditoria/LGPD.');
      return;
    }
    try {
      await start.mutateAsync({ workspaceId, reason: reason.trim() });
      // Entra no app de workspace; o middleware da API resolve o contexto do tenant.
      router.push('/');
    } catch {
      setError('Nao foi possivel iniciar a sessao view-as.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-surface-0 hover:opacity-90"
      >
        <Eye className="size-4" aria-hidden /> Ver como
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 p-4">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface-1 p-6">
            <h2 className="text-base font-semibold text-text-high">Ver como tenant (read-only)</h2>
            <p className="text-sm text-text-mid">
              Voce vera o produto pelos olhos do cliente, <strong className="text-text-high">sem poder escrever</strong>.
              A sessao e time-boxed e auditada. Informe o motivo.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-mid">Motivo (obrigatorio)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex.: investigar relato de mensagem nao entregue (ticket #123)"
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text-high placeholder:text-text-low focus:border-accent focus:outline-none"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-high"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={start.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
              >
                {start.isPending ? 'Iniciando...' : 'Iniciar view-as'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
