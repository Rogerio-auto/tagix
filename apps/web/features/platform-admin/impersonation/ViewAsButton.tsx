'use client';

/**
 * Botão "Ver como" (F26-S09) -- abre o diálogo de motivo (LGPD: motivo obrigatório),
 * inicia a sessão view-as SOMENTE LEITURA e leva ao app de workspace no contexto do tenant.
 * Consome F26-S05.
 *
 * DS 3.0 (F72-S08): o diálogo passou a ser o `Modal` do `@hm/ui` (foco preso, Esc, foco
 * devolvido ao gatilho). A regra é a mesma de antes: motivo com 5+ caracteres, a mesma
 * chamada `useStartImpersonation` com `{ workspaceId, reason }`, e só então `router.push('/')`.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, ShieldAlert } from 'lucide-react';
import { Button, Modal } from '@hm/ui';
import { textareaClass } from '../ui/kit';
import { useStartImpersonation } from './queries';

export function ViewAsButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const start = useStartImpersonation();
  const router = useRouter();
  const reasonId = useId();
  const errorId = useId();

  async function confirm() {
    setError(null);
    if (reason.trim().length < 5) {
      setError('Informe um motivo com pelo menos 5 caracteres: é exigência de auditoria (LGPD).');
      return;
    }
    try {
      await start.mutateAsync({ workspaceId, reason: reason.trim() });
      // Entra no app de workspace; o middleware da API resolve o contexto do tenant.
      router.push('/');
    } catch {
      setError('Não foi possível iniciar a sessão view-as.');
    }
  }

  return (
    <>
      <Button variant="primary" leftIcon={<Eye className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        Ver como
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ver como o tenant (somente leitura)"
        description="Você verá o produto pelos olhos do cliente, sem poder escrever. A sessão expira sozinha e fica na auditoria."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={start.isPending} onClick={() => void confirm()}>
              {start.isPending ? 'Iniciando…' : 'Iniciar view-as'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/10 px-3 py-2.5 font-body text-sm text-text">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              Workspace <span className="font-mono text-text-mid">{workspaceId}</span>
            </span>
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={reasonId} className="font-body text-sm font-bold text-text-mid">
              Motivo (obrigatório)
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ex.: investigar relato de mensagem não entregue (ticket #123)"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={textareaClass}
            />
          </div>
          {error && (
            <p id={errorId} role="alert" className="font-body text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
