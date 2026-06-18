'use client';

import { Button, Card, CardBody, useToast } from '@hm/ui';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { HealthBadge } from './HealthBadge';
import {
  useCampaignDeliveries,
  useCampaignMetrics,
  usePauseCampaign,
} from '../list/queries';
import type { CampaignDelivery } from '../list/types';

function pct(v: string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Erro recente como card empilhado — escaneável no toque (§3.9 timeline). */
function FailureCard({ delivery }: { delivery: CampaignDelivery }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-text">{delivery.errorCode ?? 'falha'}</span>
        <span className="shrink-0 text-xs text-text-low">
          {fmtTime(delivery.failedAt ?? delivery.queuedAt)}
        </span>
      </div>
      <span className="text-sm text-text-low">{delivery.errorMessage ?? '—'}</span>
    </li>
  );
}

interface StatProps {
  label: string;
  value: number | string;
}
function Stat({ label, value }: StatProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-text-low">{label}</span>
      <span className="text-2xl font-semibold text-text">{value}</span>
    </div>
  );
}

/** Painel de monitoramento real-time (CAMPAIGNS.md 12.6). Refetch 30s. */
export function CampaignMonitoring({
  campaignId,
  status,
}: {
  campaignId: string;
  status: string;
}): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const metricsQuery = useCampaignMetrics(campaignId);
  const deliveriesQuery = useCampaignDeliveries(campaignId);
  const pause = usePauseCampaign();

  const m = metricsQuery.data?.metrics;
  const failures = deliveriesQuery.data?.deliveries ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-text">Monitoramento</h2>
          {m ? <HealthBadge status={m.healthStatus} /> : null}
        </div>
        {status === 'running' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              pause.mutate(campaignId, {
                onSuccess: () => toast({ title: 'Campanha pausada', variant: 'success' }),
                onError: () => toast({ title: 'Falha ao pausar', variant: 'error' }),
              });
            }}
          >
            Pausar campanha
          </Button>
        ) : null}
      </div>

      <Card>
        <CardBody>
          {m ? (
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label="Destinatarios" value={m.totalRecipients} />
              <Stat label="Enviadas" value={m.messagesSent} />
              <Stat label="Entregues" value={m.messagesDelivered} />
              <Stat label="Respondidas" value={m.messagesReplied} />
              <Stat label="Taxa entrega" value={pct(m.deliveryRate)} />
              <Stat label="Taxa leitura" value={pct(m.readRate)} />
              <Stat label="Taxa resposta" value={pct(m.responseRate)} />
              <Stat label="Taxa bloqueio" value={pct(m.blockRate)} />
            </div>
          ) : (
            <p className="text-sm text-text-low">
              Sem metricas ainda — disponivel apos a ativacao da campanha.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="mb-3 text-sm font-semibold text-text">Erros recentes da Meta</h3>
          {failures.length === 0 ? (
            <p className="text-sm text-text-low">Nenhum erro recente.</p>
          ) : isMobile ? (
            <ul className="flex flex-col gap-2">
              {failures.slice(0, 10).map((d) => (
                <FailureCard key={d.id} delivery={d} />
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-2">
              {failures.slice(0, 10).map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
                >
                  <span className="text-text">{d.errorCode ?? 'falha'}</span>
                  <span className="text-text-low">{d.errorMessage ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
