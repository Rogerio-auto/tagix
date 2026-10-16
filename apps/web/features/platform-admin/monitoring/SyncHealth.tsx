'use client';

/**
 * Painel de saúde da sincronização (F52-S09) no DS 3.0 (F72-S08). Visão operacional,
 * densa e sóbria: pendências do workspace (KPIs em mono), profundidade das filas + DLQ +
 * retries em voo (`DataTable` compacta) e status de cada canal WhatsApp. Destaque só
 * quando o número pede ação (fila represada, DLQ não-vazia, canal degradado).
 * Auto-refresh a cada 15s: o selo "Ao vivo" pulsa (estado vivo, DS 3.0 §05).
 *
 * Gating: o backend é a fronteira (OWNER/ADMIN do workspace ou platform-admin). Sem
 * permissão → 403 → estado de acesso restrito explícito.
 *
 * UX: §2.5 `?` no título; §2.7 skeleton no formato do painel; §2.11 erro em 3 partes.
 */
import { AlertOctagon, Inbox, Paperclip, RotateCw } from 'lucide-react';
import { Badge, Button, DataTable, ErrorState, Skeleton, type BadgeTone, type DataTableColumn } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatNumber, formatTime } from '@/shared/lib/locale';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { Count, Kpi, Panel } from '../ui/kit';
import { useSyncHealth } from './queries';
import type { ChannelHealth, ChannelHealthStatus, QueueView, SyncHealth } from './client';

const CHANNEL_STATUS: Record<ChannelHealthStatus, { label: string; tone: BadgeTone }> = {
  connected: { label: 'Conectado', tone: 'success' },
  warning: { label: 'Qualidade média', tone: 'warning' },
  degraded: { label: 'Degradado', tone: 'danger' },
  inactive: { label: 'Inativo', tone: 'neutral' },
  unlinked: { label: 'Sem token', tone: 'danger' },
};

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

function LoadingState() {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando a saúde da sincronização" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

const queueColumns: DataTableColumn<QueueView>[] = [
  {
    id: 'name',
    header: 'Fila',
    cell: (q) => <span className="block truncate font-mono text-sm text-text">{q.name}</span>,
  },
  {
    id: 'messages',
    header: 'Mensagens',
    numeric: true,
    width: '8rem',
    cell: (q) => <span className={q.messages > 0 ? 'text-text' : 'text-text-low'}>{formatNumber(q.messages)}</span>,
  },
  {
    id: 'unacked',
    header: 'Sem ack',
    numeric: true,
    width: '7rem',
    cell: (q) => <span className="text-text-mid">{formatNumber(q.unacked)}</span>,
  },
  {
    id: 'consumers',
    header: 'Consumidores',
    numeric: true,
    width: '10rem',
    cell: (q) =>
      // Fila represada: mensagens prontas sem nenhum consumidor é o sinal mais grave.
      q.messages > 0 && q.consumers === 0 ? (
        <Badge tone="danger" size="sm" dot>
          Sem consumidor
        </Badge>
      ) : (
        <span className="text-text-mid">{formatNumber(q.consumers)}</span>
      ),
  },
];

function ChannelRow({ c }: { c: ChannelHealth }) {
  const s = CHANNEL_STATUS[c.status];
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-body text-sm font-semibold text-text">{c.name}</span>
        <span className="truncate font-mono text-xs text-text-low">
          {c.phoneNumber ?? c.provider}
          {c.qualityRating ? ` · quality ${c.qualityRating}` : ''}
        </span>
      </span>
      <Badge tone={s.tone} size="sm" dot>
        {s.label}
      </Badge>
    </li>
  );
}

function Loaded({ data }: { data: SyncHealth }) {
  const { isMobile } = useBreakpoint();
  const attention = data.channels.filter((c) => c.status === 'degraded' || c.status === 'unlinked');

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Pendências" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi
          label="Mensagens presas"
          icon={Inbox}
          value={formatNumber(data.pending.messages)}
          hint="Aguardando envio"
          tone={data.pending.messages > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="Mídia com falha"
          icon={Paperclip}
          value={formatNumber(data.pending.mediaFailed)}
          hint="Anexos que não enviaram"
          tone={data.pending.mediaFailed > 0 ? 'danger' : 'default'}
        />
        <Kpi
          label="DLQ"
          icon={AlertOctagon}
          value={formatNumber(data.dlq.messages)}
          hint={<span className="font-mono">{data.dlq.name}</span>}
          tone={data.dlq.messages > 0 ? 'danger' : 'default'}
        />
      </section>

      <Panel
        title="Filas"
        titleId="monitoring-queues"
        body="flush"
        action={
          data.mq.reachable ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-sm tabular-nums text-text-low">
              <RotateCw className="size-3.5" aria-hidden />
              {formatNumber(data.retryInFlight)} em retry
            </span>
          ) : (
            <Badge tone="danger" size="sm" dot>
              Broker inacessível
            </Badge>
          )
        }
      >
        {data.mq.reachable && isMobile ? (
          // No celular a tabela de 4 colunas rolaria na horizontal; vira lista (fila + números).
          <ul aria-label="Filas" className="divide-y divide-border">
            {data.queues.map((q) => {
              const stalled = q.messages > 0 && q.consumers === 0;
              return (
                <li key={q.name} className="flex flex-col gap-1.5 px-5 py-3">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-sm text-text">{q.name}</span>
                    {stalled && (
                      <Badge tone="danger" size="sm" dot>
                        Sem consumidor
                      </Badge>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-x-4 font-mono text-xs tabular-nums text-text-low">
                    <span>
                      <span className="text-text">{formatNumber(q.messages)}</span> msgs
                    </span>
                    <span>{formatNumber(q.unacked)} sem ack</span>
                    <span>{formatNumber(q.consumers)} cons.</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : data.mq.reachable ? (
          <DataTable<QueueView>
            caption="Filas"
            columns={queueColumns}
            rows={data.queues}
            getRowId={(q) => q.name}
            density="compact"
            getRowState={(q) => (q.messages > 0 && q.consumers === 0 ? 'attention' : undefined)}
            className="rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)] border-0"
          />
        ) : (
          <p className="px-5 py-4 font-body text-sm text-text-mid">
            Não foi possível ler a profundidade das filas
            {data.mq.error ? (
              <>
                : <span className="font-mono text-text">{data.mq.error}</span>.
              </>
            ) : (
              '.'
            )}{' '}
            As pendências do banco acima continuam atualizadas.
          </p>
        )}
      </Panel>

      <Panel
        title="Canais WhatsApp"
        titleId="monitoring-channels"
        body="flush"
        tone={attention.length > 0 ? 'warn' : 'default'}
        action={
          attention.length > 0 ? (
            <Badge tone="danger" size="sm" dot>
              {formatNumber(attention.length)} com atenção
            </Badge>
          ) : (
            <Count value={formatNumber(data.channels.length)} label={`${data.channels.length} canais`} />
          )
        }
      >
        {data.channels.length === 0 ? (
          <p className="px-5 py-6 text-center font-body text-sm text-text-low">
            Nenhum canal WhatsApp configurado neste workspace.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.channels.map((c) => (
              <ChannelRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function SyncHealthPanel() {
  const query = useSyncHealth();

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/monitoring"
        title="Saúde da sincronização"
        description={
          query.data ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge tone="success" size="sm" live>
                Ao vivo
              </Badge>
              atualizado às{' '}
              <span className="font-mono tabular-nums text-text-mid">{formatTime(query.data.generatedAt, CLOCK)}</span>
              · a cada 15 s
            </span>
          ) : (
            'Filas, DLQ e conexão dos canais. Atualiza a cada 15 s.'
          )
        }
      />

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
            action={
              <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        )
      ) : query.data ? (
        <Loaded data={query.data} />
      ) : null}
    </div>
  );
}
