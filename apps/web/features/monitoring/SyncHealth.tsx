'use client';

/**
 * Painel de saúde da sincronização (F52-S09). Visão operacional, densa e sóbria
 * (dark-first, zero hex): pendências do workspace, profundidade de filas + DLQ +
 * retries em voo, e status de cada canal WhatsApp. Destaque acionável quando há
 * fila represada / DLQ não-vazia / canal degradado (UX_PRINCIPLES.md). Auto-refresh.
 *
 * Gating: o backend é a fronteira (OWNER/ADMIN do workspace ou platform-admin). Um
 * usuário sem permissão recebe 403 → estado de acesso restrito explícito. Em paralelo
 * a sidebar/rota já escondem o item por role.
 */
import { ApiError } from '@/shared/lib/api-client';
import { ErrorState } from '@/shared/components/feedback';
import { Skeleton } from '@/shared/components/feedback';
import { useSyncHealth } from './queries';
import type { ChannelHealth, ChannelHealthStatus, QueueView, SyncHealth } from './client';

const num = (n: number): string => n.toLocaleString('pt-BR');

const CHANNEL_STATUS: Record<
  ChannelHealthStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }
> = {
  connected: { label: 'Conectado', tone: 'success' },
  warning: { label: 'Qualidade média', tone: 'warning' },
  degraded: { label: 'Degradado', tone: 'danger' },
  inactive: { label: 'Inativo', tone: 'muted' },
  unlinked: { label: 'Sem token', tone: 'danger' },
};

function toneText(tone: 'success' | 'warning' | 'danger' | 'muted'): string {
  if (tone === 'success') return 'text-success';
  if (tone === 'warning') return 'text-warning';
  if (tone === 'danger') return 'text-danger';
  return 'text-text-low';
}

function StatusBadge({ tone, label }: { tone: 'success' | 'warning' | 'danger' | 'muted'; label: string }) {
  const dot =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'danger'
          ? 'bg-danger'
          : 'bg-text-low';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      <span className={toneText(tone)}>{label}</span>
    </span>
  );
}

/** Card de KPI com destaque opcional quando o valor é acionável (> 0). */
function MetricCard({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        alert ? 'border-danger bg-danger-bg' : 'border-border bg-surface'
      }`}
    >
      <p className="font-head text-xs font-semibold uppercase tracking-wide text-text-low">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-semibold ${alert ? 'text-danger' : 'text-text'}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-text-low">{hint}</p>}
    </div>
  );
}

function QueueRow({ q }: { q: QueueView }) {
  // Fila represada: mensagens prontas sem nenhum consumidor é o sinal mais grave.
  const stalled = q.messages > 0 && q.consumers === 0;
  return (
    <tr className="border-t border-border">
      <td className="py-2.5 pr-4 font-mono text-xs text-text-mid">{q.name}</td>
      <td className={`py-2.5 pr-4 text-right font-mono text-sm ${q.messages > 0 ? 'text-text' : 'text-text-low'}`}>
        {num(q.messages)}
      </td>
      <td className="py-2.5 pr-4 text-right font-mono text-xs text-text-low">{num(q.unacked)}</td>
      <td className="py-2.5 text-right">
        {stalled ? (
          <StatusBadge tone="danger" label="Sem consumidor" />
        ) : (
          <span className="font-mono text-xs text-text-low">{num(q.consumers)} cons.</span>
        )}
      </td>
    </tr>
  );
}

function ChannelRow({ c }: { c: ChannelHealth }) {
  const s = CHANNEL_STATUS[c.status];
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text">{c.name}</p>
        <p className="truncate font-mono text-xs text-text-low">
          {c.phoneNumber ?? c.provider}
          {c.qualityRating ? ` · quality ${c.qualityRating}` : ''}
        </p>
      </div>
      <StatusBadge tone={s.tone} label={s.label} />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

function Loaded({ data }: { data: SyncHealth }) {
  const dlqAlert = data.dlq.messages > 0;
  const mediaAlert = data.pending.mediaFailed > 0;
  const degradedChannels = data.channels.filter((c) => c.status === 'degraded' || c.status === 'unlinked');

  return (
    <div className="flex flex-col gap-6">
      {/* Pendências do workspace */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Mensagens presas"
          value={num(data.pending.messages)}
          hint="aguardando envio (pending/sending)"
          alert={data.pending.messages > 0}
        />
        <MetricCard
          label="Mídia falhada"
          value={num(data.pending.mediaFailed)}
          hint="anexos que não enviaram"
          alert={mediaAlert}
        />
        <MetricCard
          label="DLQ"
          value={num(data.dlq.messages)}
          hint="mensagens mortas a inspecionar"
          alert={dlqAlert}
        />
      </div>

      {/* Filas */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-head text-sm font-semibold uppercase tracking-wide text-text-low">Filas</h3>
          {data.mq.reachable ? (
            <span className="font-mono text-xs text-text-low">{num(data.retryInFlight)} em retry</span>
          ) : (
            <StatusBadge tone="danger" label="Broker inacessível" />
          )}
        </div>
        {data.mq.reachable ? (
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="pb-1 text-xs font-semibold uppercase tracking-wide text-text-low">Fila</th>
                <th className="pb-1 text-right text-xs font-semibold uppercase tracking-wide text-text-low">Msgs</th>
                <th className="pb-1 text-right text-xs font-semibold uppercase tracking-wide text-text-low">Unacked</th>
                <th className="pb-1 text-right text-xs font-semibold uppercase tracking-wide text-text-low">Consumidores</th>
              </tr>
            </thead>
            <tbody>
              {data.queues.map((q) => (
                <QueueRow key={q.name} q={q} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-text-mid">
            Não foi possível ler a profundidade das filas{data.mq.error ? `: ${data.mq.error}` : '.'} As
            pendências do banco abaixo continuam atualizadas.
          </p>
        )}
      </section>

      {/* Canais */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-head text-sm font-semibold uppercase tracking-wide text-text-low">
            Canais WhatsApp
          </h3>
          {degradedChannels.length > 0 && (
            <StatusBadge tone="danger" label={`${degradedChannels.length} com atenção`} />
          )}
        </div>
        {data.channels.length === 0 ? (
          <p className="text-sm text-text-mid">Nenhum canal WhatsApp configurado neste workspace.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.channels.map((c) => (
              <ChannelRow key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function SyncHealthPanel() {
  const query = useSyncHealth();

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-head text-xl font-semibold text-text">Saúde da sincronização</h1>
          <p className="mt-1 text-sm text-text-mid">
            Estado das filas, da DLQ e da conexão dos canais. Atualiza a cada 15s.
          </p>
        </div>
        {query.data && (
          <p className="font-mono text-xs text-text-low">
            atualizado {new Date(query.data.generatedAt).toLocaleTimeString('pt-BR')}
          </p>
        )}
      </header>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        query.error instanceof ApiError && query.error.status === 403 ? (
          <ErrorState
            title="Acesso restrito"
            reason="Este painel é exclusivo de administradores do workspace."
            whatToDo="Fale com um OWNER ou ADMIN se precisar acompanhar a sincronização."
          />
        ) : (
          <ErrorState
            title="Falha ao carregar a saúde da sincronização"
            reason={query.error instanceof Error ? query.error.message : undefined}
            whatToDo="Tente novamente em instantes."
            reference={query.error instanceof ApiError ? query.error.ref : undefined}
          />
        )
      ) : query.data ? (
        <Loaded data={query.data} />
      ) : null}
    </section>
  );
}
