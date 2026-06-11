'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardBody, useToast } from '@hm/ui';
import {
  useCampaigns,
  useCancelCampaign,
  usePauseCampaign,
  useResumeCampaign,
} from './queries';
import type { Campaign, CampaignStatus } from './types';

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em execucao',
  paused: 'Pausada',
  completed: 'Concluida',
  cancelled: 'Cancelada',
};

const STATUS_CLS: Record<CampaignStatus, string> = {
  draft: 'bg-surface-3 text-text-mid',
  scheduled: 'bg-info/15 text-info',
  running: 'bg-success/15 text-success',
  paused: 'bg-warn/15 text-warn',
  completed: 'bg-surface-3 text-text-mid',
  cancelled: 'bg-danger/15 text-danger',
};

const FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'running', label: 'Em execucao' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'completed', label: 'Concluidas' },
];

function CampaignCard({ campaign }: { campaign: Campaign }): React.JSX.Element {
  const { toast } = useToast();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const cancel = useCancelCampaign();

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Link href={`/campaigns/${campaign.id}`} className="text-base font-semibold text-text hover:text-brand">
              {campaign.name}
            </Link>
            <span className="text-xs text-text-low">
              {campaign.type} · {campaign.rateLimitPerMinute}/min
            </span>
          </div>
          <span
            className={'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ' + STATUS_CLS[campaign.status]}
          >
            {STATUS_LABEL[campaign.status]}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {campaign.status === 'running' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                pause.mutate(campaign.id, {
                  onSuccess: () => toast({ title: 'Campanha pausada', variant: 'success' }),
                  onError: () => toast({ title: 'Falha ao pausar', variant: 'error' }),
                })
              }
            >
              Pausar
            </Button>
          ) : null}
          {campaign.status === 'paused' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                resume.mutate(campaign.id, {
                  onSuccess: () => toast({ title: 'Campanha retomada', variant: 'success' }),
                  onError: () => toast({ title: 'Falha ao retomar', variant: 'error' }),
                })
              }
            >
              Retomar
            </Button>
          ) : null}
          {campaign.status !== 'cancelled' && campaign.status !== 'completed' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                cancel.mutate(campaign.id, {
                  onSuccess: () => toast({ title: 'Campanha cancelada', variant: 'success' }),
                  onError: () => toast({ title: 'Falha ao cancelar', variant: 'error' }),
                })
              }
            >
              Cancelar
            </Button>
          ) : null}
          <Link href={`/campaigns/${campaign.id}/edit`}>
            <Button variant="ghost" size="sm">
              Editar
            </Button>
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

/** Pagina /campaigns (CAMPAIGNS.md 12.1): lista + filtro + acoes. */
export function CampaignsPage(): React.JSX.Element {
  const [status, setStatus] = useState('');
  const { data, isLoading } = useCampaigns(status);
  const campaigns = data?.campaigns ?? [];

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-text">Campanhas</h1>
        <Link href="/campaigns/new">
          <Button variant="primary" size="sm">
            Nova campanha
          </Button>
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            type="button"
            onClick={() => setStatus(f.value)}
            className={
              'rounded-full border px-3 py-1 text-sm transition-colors ' +
              (status === f.value
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text-mid hover:bg-surface-2')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-text-low">Carregando…</p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-text-low">
              Nenhuma campanha ainda. Crie a primeira para comecar.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}
