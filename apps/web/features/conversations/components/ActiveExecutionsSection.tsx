'use client';

/**
 * Painel "Execuções Ativas" do cockpit (F51 / refino S07) — monitor premium em tempo real, no
 * TOPO do cockpit. Mostra APENAS execuções ativas (running/waiting); ao cancelar/concluir o card
 * some sozinho (socket invalida a query + filtro só-ativas). Card compacto com borda neon viva
 * (`.hm-flow-neon`, mesma da conversa selecionada, intensidade moderada). DS v2: só tokens.
 */

import { useState } from 'react';
import { Activity, Eye, Timer, X, Zap } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Modal, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ExecutionDetailDrawer } from '@/features/flow-builder/livechat/ExecutionDetailDrawer';
import {
  useCancelConversationExecution,
  useCockpitExecutions,
  type ConversationExecution,
} from '@/features/flow-builder/livechat/queries';
import { useCountdown } from '../hooks/useCountdown';
import { useFlowExecutionsLive } from '../hooks/useFlowExecutionsLive';

type ActiveStatus = 'running' | 'waiting';

const STATUS_META: Record<
  ActiveStatus,
  { label: string; icon: React.ComponentType<{ className?: string }>; dot: string; text: string }
> = {
  running: { label: 'Executando', icon: Activity, dot: 'bg-accent', text: 'text-accent' },
  waiting: { label: 'Agendado', icon: Timer, dot: 'bg-warning', text: 'text-warning' },
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Card compacto de uma execução ATIVA, com borda neon viva. */
function ExecutionCard({
  exec,
  canCancel,
  onCancel,
  onDetails,
}: {
  exec: ConversationExecution;
  canCancel: boolean;
  onCancel: (id: string) => void;
  onDetails: (id: string) => void;
}) {
  const status = exec.status as ActiveStatus;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const isWaiting = status === 'waiting';
  const { remainingMs, isExpired } = useCountdown(isWaiting ? exec.nextStepAt : null);

  return (
    // hm-flow-neon: borda neon + glow + animação percorrendo (respeita prefers-reduced-motion).
    <div className="hm-flow-neon relative rounded-md border border-border-2 bg-surface-2 px-3 py-2.5 shadow-elev-1">
      {/* Linha 1: nome + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex size-2 shrink-0">
            <span
              className={cn('absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping', meta.dot)}
              aria-hidden
            />
            <span className={cn('relative inline-flex size-2 rounded-full', meta.dot)} aria-hidden />
          </span>
          <span className="truncate font-body text-sm font-semibold text-text">
            {exec.flowName ?? 'Flow'}
          </span>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px] font-medium', meta.text)}>
          <Icon className="size-3 motion-safe:animate-pulse" aria-hidden />
          {meta.label}
        </span>
      </div>

      {/* Linha 2: countdown + horário previsto do próximo passo */}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-text-low">Iniciado {fmtTime(exec.startedAt)}</span>
        {isWaiting ? (
          <span className="font-medium text-warning">
            {isExpired ? 'Retomando…' : `Conclui ${fmtTime(exec.nextStepAt)} · ${fmtRemaining(remainingMs)}`}
          </span>
        ) : (
          <span className="text-text-low">Em execução…</span>
        )}
      </div>

      {/* Barra discreta (indeterminada — wait window não tem início conhecido) */}
      <div className="mt-2 h-1 overflow-hidden rounded-pill bg-surface-3">
        <div
          className={cn(
            'h-full w-full rounded-pill motion-safe:animate-pulse',
            isWaiting ? 'bg-warning/70' : 'bg-accent/70',
          )}
        />
      </div>

      {/* Ações */}
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Eye className="size-3.5" aria-hidden />}
          onClick={() => onDetails(exec.id)}
        >
          Detalhes
        </Button>
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="size-3.5" aria-hidden />}
            onClick={() => onCancel(exec.id)}
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

export function ActiveExecutionsSection({ conversationId }: { conversationId: string }) {
  const role = useAuthStore((s) => s.auth?.role);
  const canCancel = role ? can(role, 'flow.cancel') : false;
  const { toast } = useToast();

  const executions = useCockpitExecutions(conversationId);
  useFlowExecutionsLive(conversationId);
  const cancel = useCancelConversationExecution(conversationId);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // APENAS ativas (running/waiting). Mais recentes primeiro.
  const active = (executions.data ?? [])
    .filter((e) => e.status === 'running' || e.status === 'waiting')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  // Vazio → some completamente (não ocupa espaço).
  if (active.length === 0) return null;

  const confirmCancel = async (): Promise<void> => {
    if (!confirmId) return;
    try {
      await cancel.mutateAsync(confirmId);
      toast({ variant: 'success', title: 'Execução cancelada' });
      setConfirmId(null);
    } catch {
      toast({ variant: 'error', title: 'Falha ao cancelar', description: 'Tente novamente.' });
    }
  };

  return (
    <section className="rounded-md border border-border-2 bg-surface-1 p-3 shadow-elev-1">
      <header className="mb-2.5 flex items-center gap-2">
        <Zap className="size-4 text-accent" aria-hidden />
        <h3 className="font-head text-sm font-semibold text-text">Execuções Ativas</h3>
        <span className="ml-auto inline-flex items-center gap-1 rounded-pill bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
          <Activity className="size-3" aria-hidden />
          {active.length}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {active.map((exec) => (
          <ExecutionCard
            key={exec.id}
            exec={exec}
            canCancel={canCancel}
            onCancel={setConfirmId}
            onDetails={setDetailId}
          />
        ))}
      </div>

      {/* Detalhes (reusa o drawer do flow-builder) */}
      <ExecutionDetailDrawer
        executionId={detailId}
        conversationId={conversationId}
        onClose={() => setDetailId(null)}
      />

      {/* Confirmação de cancelamento */}
      <Modal
        open={confirmId !== null}
        onClose={() => !cancel.isPending && setConfirmId(null)}
        title="Cancelar execução"
        description="Tem certeza que deseja interromper esta automação? O flow para imediatamente e não pode ser retomado."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)} disabled={cancel.isPending}>
              Voltar
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => void confirmCancel()}>
              Cancelar execução
            </Button>
          </>
        }
      />
    </section>
  );
}
