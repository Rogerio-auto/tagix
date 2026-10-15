'use client';

import { CircleCheck, Radio } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Skeleton,
  type DataTableColumn,
} from '@hm/ui';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { EMPTY, formatDateTime, formatNumber, formatPercent, formatTime } from '@/shared/lib/locale';
import { HealthBadge } from './HealthBadge';
import { useCampaignDeliveries, useCampaignMetrics } from '../list/queries';
import type { CampaignDelivery, CampaignMetrics } from '../list/types';

const RECENT_FAILURES = 10;
const WHEN: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

/**
 * Taxa da API (string em pontos percentuais, "95.5") → "95,5%" no idioma da interface.
 * Abaixo de 1% ganha uma casa a mais: bloqueio de 0,03% não pode aparecer como "0%".
 */
function pct(value: string | null): string {
  if (value == null) return EMPTY;
  const n = Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  return formatPercent(n / 100, { maximumFractionDigits: n > 0 && n < 1 ? 2 : 1 });
}

/** Bloco de número do DS 3.0: rótulo em mono caixa-alta, valor em mono tabular. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-4">
      <dt className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-h4 font-medium tabular-nums tracking-tight text-text md:text-h3">
          {value}
        </span>
        {hint ? <span className="font-mono text-xs tabular-nums text-text-low">{hint}</span> : null}
      </dd>
    </div>
  );
}

/** Taxas numa faixa só, separadas por hairline: lidas em sequência, como um funil. */
function Rate({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-surface px-5 py-4">
      <dt className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">{label}</dt>
      <dd className="font-mono text-lg font-medium tabular-nums text-text">{value}</dd>
    </div>
  );
}

function MetricsBlock({ m }: { m: CampaignMetrics }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Destinatários" value={formatNumber(m.totalRecipients)} />
        <Stat
          label="Enviadas"
          value={formatNumber(m.messagesSent)}
          hint={`${formatNumber(m.messagesQueued)} na fila`}
        />
        <Stat label="Entregues" value={formatNumber(m.messagesDelivered)} />
        <Stat
          label="Respondidas"
          value={formatNumber(m.messagesReplied)}
          hint={`${formatNumber(m.messagesFailed)} falhas`}
        />
      </dl>
      {/* Hairline entre as células: o fundo da grade aparece pelo `gap-px`. */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        <Rate label="Entrega" value={pct(m.deliveryRate)} />
        <Rate label="Leitura" value={pct(m.readRate)} />
        <Rate label="Resposta" value={pct(m.responseRate)} />
        <Rate label="Bloqueio" value={pct(m.blockRate)} />
      </dl>
    </div>
  );
}

const FAILURE_COLUMNS: DataTableColumn<CampaignDelivery>[] = [
  {
    id: 'code',
    header: 'Código',
    width: '9rem',
    cell: (d) => <span className="font-mono text-sm text-text">{d.errorCode ?? 'falha'}</span>,
  },
  { id: 'reason', header: 'Motivo', cell: (d) => <span className="text-text-mid">{d.errorMessage ?? EMPTY}</span> },
  {
    id: 'when',
    header: 'Quando',
    numeric: true,
    width: '9rem',
    cell: (d) => <span className="text-text-mid">{formatDateTime(d.failedAt ?? d.queuedAt, WHEN)}</span>,
  },
];

/** Erro recente como card empilhado: escaneável no toque (§3.9). */
function FailureCard({ delivery }: { delivery: CampaignDelivery }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-medium text-text">{delivery.errorCode ?? 'falha'}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-text-low">
          {formatDateTime(delivery.failedAt ?? delivery.queuedAt, WHEN)}
        </span>
      </div>
      <span className="text-sm text-text-mid">{delivery.errorMessage ?? EMPTY}</span>
    </li>
  );
}

/**
 * Monitoramento da campanha (CAMPAIGNS.md 12.6) no DS 3.0 (F72-S07). Recarrega a cada
 * 30 s. Volume em blocos de número mono, taxas numa faixa só (o funil lido em linha) e
 * os erros recentes da Meta em `DataTable` (cards no celular).
 */
export function CampaignMonitoring({ campaignId }: { campaignId: string }): React.JSX.Element {
  const { isMobile } = useBreakpoint();
  const metricsQuery = useCampaignMetrics(campaignId);
  const deliveriesQuery = useCampaignDeliveries(campaignId);

  const m = metricsQuery.data?.metrics;
  const failures = (deliveriesQuery.data?.deliveries ?? []).slice(0, RECENT_FAILURES);

  const failuresEmpty = (
    <EmptyState
      icon={CircleCheck}
      title="Nenhum erro recente"
      description="Quando a Meta recusar um envio, o código e o motivo aparecem aqui."
    />
  );
  const failuresError = (
    <ErrorState
      title="Não foi possível carregar os erros"
      reason="A lista de entregas com falha não respondeu."
      whatToDo="Tente de novo em instantes."
      action={
        <Button
          variant="secondary"
          size="sm"
          loading={deliveriesQuery.isFetching}
          onClick={() => void deliveriesQuery.refetch()}
        >
          Tentar de novo
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="campaign-results" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 id="campaign-results" className="font-head text-lg font-medium text-text">
              Resultado
            </h2>
            {m ? <HealthBadge status={m.healthStatus} /> : null}
          </div>
          {m ? (
            <span className="font-mono text-xs tabular-nums text-text-low">
              Atualizado às {formatTime(m.updatedAt)}
            </span>
          ) : null}
        </div>

        {metricsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy aria-label="Carregando resultado">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : metricsQuery.isError ? (
          <ErrorState
            title="Não foi possível carregar o resultado"
            reason="As métricas da campanha não responderam."
            whatToDo="Tente de novo em instantes."
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={metricsQuery.isFetching}
                onClick={() => void metricsQuery.refetch()}
              >
                Tentar de novo
              </Button>
            }
          />
        ) : m ? (
          <MetricsBlock m={m} />
        ) : (
          <EmptyState
            icon={Radio}
            title="Sem resultado ainda"
            description="Os números aparecem assim que a campanha for ativada e começar a enviar."
          />
        )}
      </section>

      <section aria-labelledby="campaign-failures" className="flex flex-col gap-4">
        <h2 id="campaign-failures" className="font-head text-lg font-medium text-text">
          Erros recentes da Meta
        </h2>
        {isMobile ? (
          deliveriesQuery.isLoading ? (
            <Skeleton className="h-32 rounded-lg" />
          ) : deliveriesQuery.isError ? (
            failuresError
          ) : failures.length === 0 ? (
            failuresEmpty
          ) : (
            <ul className="flex flex-col gap-2">
              {failures.map((d) => (
                <FailureCard key={d.id} delivery={d} />
              ))}
            </ul>
          )
        ) : (
          <DataTable<CampaignDelivery>
            caption="Erros recentes da Meta"
            columns={FAILURE_COLUMNS}
            rows={failures}
            getRowId={(d) => d.id}
            density="compact"
            loading={deliveriesQuery.isLoading}
            loadingRows={3}
            error={deliveriesQuery.isError ? failuresError : undefined}
            empty={failuresEmpty}
          />
        )}
      </section>
    </div>
  );
}
