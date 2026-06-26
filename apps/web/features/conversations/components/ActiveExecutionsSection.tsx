'use client';

/**
 * Seção "Execuções Ativas" do cockpit (F51) — monitoramento em tempo real dos flows do contato.
 * Lista as execuções em andamento (Executando/Agendado) + as recém-finalizadas (≤10 min) e
 * atualiza ao vivo via socket (`useFlowExecutionsLive`) com countdown client-side. DS v2: só tokens.
 */

import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  Timer,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
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

type Status = ConversationExecution['status'];

const RECENT_WINDOW_MS = 10 * 60 * 1000;

const STATUS_META: Record<
  Status,
  { label: string; icon: React.ComponentType<{ className?: string }>; dot: string; text: string; active: boolean }
> = {
  running: { label: 'Executando', icon: Activity, dot: 'bg-accent', text: 'text-accent', active: true },
  waiting: { label: 'Agendado', icon: Timer, dot: 'bg-warning', text: 'text-warning', active: true },
  completed: { label: 'Concluído', icon: CheckCircle2, dot: 'bg-success', text: 'text-success', active: false },
  cancelled: { label: 'Cancelado', icon: XCircle, dot: 'bg-text-low', text: 'text-text-low', active: false },
  failed: { label: 'Erro', icon: AlertTriangle, dot: 'bg-danger', text: 'text-danger', active: false },
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function recentFinished(e: ConversationExecution): boolean {
  if (e.status === 'running' || e.status === 'waiting') return false;
  if (!e.completedAt) return false;
  return Date.now() - new Date(e.completedAt).getTime() <= RECENT_WINDOW_MS;
}

/** Card de uma execução. Componente próprio para hospedar o countdown e o estado de expansão. */
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
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[exec.status];
  const Icon = meta.icon;
  const isWaiting = exec.status === 'waiting';
  const isActive = meta.active;
  const { remainingMs, isExpired } = useCountdown(isWaiting ? exec.nextStepAt : null);

  return (
    <div
      className={cn(
        'rounded-md border bg-surface-2 px-3 py-2.5',
        isActive ? 'border-border-2 shadow-elev-1' : 'border-border-2/60',
      )}
    >
      {/* Cabeçalho: ícone + nome + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex size-2 shrink-0">
            {isActive && (
              <span
                className={cn(
                  'absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping',
                  meta.dot,
                )}
                aria-hidden
              />
            )}
            <span className={cn('relative inline-flex size-2 rounded-full', meta.dot)} aria-hidden />
          </span>
          <span className="truncate font-body text-sm font-medium text-text">
            {exec.flowName ?? 'Flow'}
          </span>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px] font-medium', meta.text)}>
          <Icon className={cn('size-3', isActive && 'motion-safe:animate-pulse')} aria-hidden />
          {meta.label}
        </span>
      </div>

      {/* Linha de tempo: iniciado + countdown (waiting) */}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-low">
        <span>Iniciado {fmtTime(exec.startedAt)}</span>
        {isWaiting && (
          <span className="font-medium text-warning">
            {isExpired ? 'Retomando…' : `Próximo passo em ${fmtRemaining(remainingMs)}`}
          </span>
        )}
      </div>

      {/* Barra de progresso: ativa = animada (indeterminada); terminal = ausente */}
      {isActive && (
        <div className="mt-2 h-1 overflow-hidden rounded-pill bg-surface-3">
          <div
            className={cn(
              'h-full rounded-pill motion-safe:animate-pulse',
              isWaiting ? 'bg-warning/70' : 'bg-accent/70',
            )}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Ações */}
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Eye className="size-3.5" aria-hidden />}
          onClick={() => onDetails(exec.id)}
        >
          Detalhes
        </Button>
        {canCancel && isActive && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="size-3.5" aria-hidden />}
            onClick={() => onCancel(exec.id)}
          >
            Cancelar
          </Button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="ml-auto inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-text-low hover:text-text-mid focus-visible:shadow-glow-sm focus-visible:outline-none"
        >
          Técnico
          <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {/* Info técnica expansível */}
      {expanded && (
        <dl className="mt-2 space-y-1 border-t border-border-2 pt-2 text-[11px] text-text-low">
          <div className="flex justify-between gap-2">
            <dt>Data e hora</dt>
            <dd className="text-text-mid">{fmtDateTime(exec.startedAt)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Nó atual</dt>
            <dd className="truncate font-mono text-text-mid">{exec.currentNodeId ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Execução</dt>
            <dd className="truncate font-mono text-text-mid">{exec.id}</dd>
          </div>
          {exec.lastError && (
            <div className="flex justify-between gap-2">
              <dt>Erro</dt>
              <dd className="truncate text-danger">{exec.lastError}</dd>
            </div>
          )}
        </dl>
      )}
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

  const all = executions.data ?? [];
  const active = all
    .filter((e) => e.status === 'running' || e.status === 'waiting')
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const recent = all
    .filter(recentFinished)
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());

  // Cockpit limpo: a seção some quando não há nada a mostrar (mesmo critério do badge).
  if (active.length === 0 && recent.length === 0) return null;

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
    <div className="rounded-md border border-border-2 bg-surface-2 p-4 shadow-elev-1">
      <header className="mb-3 flex items-center gap-2">
        <Zap className="size-4 text-text-low" aria-hidden />
        <h3 className="font-head text-sm font-semibold text-text">Execuções Ativas</h3>
        {active.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-pill bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
            <Activity className="size-3" aria-hidden />
            {active.length}
          </span>
        )}
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

        {recent.length > 0 && (
          <>
            {active.length > 0 && (
              <p className="mt-1 font-body text-[11px] font-medium uppercase tracking-wide text-text-low">
                Recém-finalizadas
              </p>
            )}
            {recent.map((exec) => (
              <ExecutionCard
                key={exec.id}
                exec={exec}
                canCancel={canCancel}
                onCancel={setConfirmId}
                onDetails={setDetailId}
              />
            ))}
          </>
        )}
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
    </div>
  );
}
