'use client';

import { X } from 'lucide-react';
import { Button, IconButton, Skeleton } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { formatNumber, formatTime } from '@/shared/lib/locale';
import { useCancelExecution, useFlowExecutions } from '../hooks/useFlowExecutions';
import { ExecutionStatusPill, isExecutionActive } from '../shared/execution-status';

/**
 * Execuções ativas do flow (FLOW_BUILDER seção 9.5) no DS 3.0 (F72-S07): contagem em
 * mono, status no `StatusPill` (só "Em execução" pulsa), id e horário em mono e cancelar
 * por linha. Estados: carregando (skeleton), erro em 3 partes compacto, vazio.
 * Só leitura (F71-S17): cancelar fica `aria-disabled` com a explicação.
 */
export function ExecutionsPanel({ flowId }: { flowId: string }) {
  const executions = useFlowExecutions(flowId);
  const cancel = useCancelExecution(flowId);
  const rows = executions.data?.executions ?? [];
  const active = rows.filter((e) => isExecutionActive(e.status));

  return (
    <section aria-labelledby="flow-executions-title" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="flow-executions-title" className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">
          Execuções ativas
        </h2>
        {executions.data && (
          <span className="rounded-pill border border-border bg-surface-2 px-2 font-mono text-xs tabular-nums leading-5 text-text-mid">
            {formatNumber(active.length)}
          </span>
        )}
      </div>

      {executions.isLoading ? (
        <div className="space-y-1.5" aria-busy aria-label="Carregando execuções">
          <Skeleton className="h-11 rounded-sm" />
          <Skeleton className="h-11 rounded-sm" />
        </div>
      ) : executions.isError ? (
        <div className="space-y-2 text-xs leading-snug">
          <p className="font-medium text-text">Não foi possível carregar as execuções.</p>
          <p className="text-text-low">A consulta falhou ou expirou. Tente de novo em instantes.</p>
          <Button variant="secondary" size="sm" loading={executions.isFetching} onClick={() => void executions.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : active.length === 0 ? (
        <p className="text-xs leading-snug text-text-low">Nenhuma execução em andamento.</p>
      ) : (
        <ul className="space-y-1.5">
          {active.map((exec) => (
            <li
              key={exec.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface-2 py-1.5 pl-2.5 pr-1"
            >
              <div className="min-w-0 space-y-1">
                <ExecutionStatusPill status={exec.status} />
                <p className="truncate font-mono text-[11px] tabular-nums text-text-low">
                  {exec.startedAt ? `${formatTime(exec.startedAt)} · ` : ''}
                  {exec.id}
                </p>
              </div>
              <ReadOnlyGuard>
                <IconButton
                  size="sm"
                  variant="danger"
                  icon={<X />}
                  aria-label={`Cancelar execução ${exec.id}`}
                  loading={cancel.isPending && cancel.variables === exec.id}
                  onClick={() => cancel.mutate(exec.id)}
                />
              </ReadOnlyGuard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
