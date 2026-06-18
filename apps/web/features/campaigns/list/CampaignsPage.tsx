'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Megaphone, Plus } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import {
  ResponsiveTable,
  type ActiveFilterChip,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
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

function StatusBadge({ status }: { status: CampaignStatus }): React.JSX.Element {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ' +
        STATUS_CLS[status]
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Ações inline da campanha. `stopPropagation` evita disparar o clique da linha/card. */
function RowActions({ campaign }: { campaign: Campaign }): React.JSX.Element {
  const { toast } = useToast();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const cancel = useCancelCampaign();
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={stop}>
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
      <Link href={`/campaigns/${campaign.id}/edit`} onClick={stop}>
        <Button variant="ghost" size="sm">
          Editar
        </Button>
      </Link>
    </div>
  );
}

/** Pagina /campaigns (CAMPAIGNS.md 12.1): lista + filtro + acoes.
 *  Adota `ResponsiveTable`: tabela densa em md+, cards em mobile (filtros em sheet). */
export function CampaignsPage(): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { data, isLoading, isError } = useCampaigns(status);
  const campaigns = useMemo(() => data?.campaigns ?? [], [data]);

  const columns = useMemo<ResponsiveColumn<Campaign>[]>(
    () => [
      {
        id: 'name',
        header: 'Campanha',
        card: 'primary',
        cell: (c) => <span className="font-medium text-text">{c.name}</span>,
      },
      {
        id: 'type',
        header: 'Tipo',
        card: 'secondary',
        cell: (c) => (
          <span className="text-text-low">
            {c.type} · {c.rateLimitPerMinute}/min
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        card: 'badge',
        align: 'left',
        cell: (c) => <StatusBadge status={c.status} />,
      },
      {
        id: 'actions',
        header: 'Ações',
        card: 'meta',
        align: 'right',
        cell: (c) => <RowActions campaign={c} />,
      },
    ],
    [],
  );

  const activeFilters = useMemo<ActiveFilterChip[]>(() => {
    if (!status) return [];
    const f = FILTERS.find((x) => x.value === status);
    return [{ id: 'status', label: `Status: ${f?.label ?? status}`, onClear: () => setStatus('') }];
  }, [status]);

  const filterControls = (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((f) => (
        <button
          key={f.value || 'all'}
          type="button"
          onClick={() => setStatus(f.value)}
          className={
            'touch-target rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:shadow-glow-md ' +
            (status === f.value
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-surface text-text-mid hover:bg-surface-2')
          }
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-head text-lg font-semibold text-text">Campanhas</h1>
        <Link href="/campaigns/new">
          <Button variant="primary" size="sm">
            <Plus className="size-4" />
            Nova campanha
          </Button>
        </Link>
      </header>

      <ResponsiveTable<Campaign>
        ariaLabel="Campanhas"
        rows={campaigns}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={(c) => router.push(`/campaigns/${c.id}`)}
        rowLabel={(c) => `Abrir campanha ${c.name}`}
        filters={filterControls}
        filtersTitle="Filtrar campanhas"
        activeFilters={activeFilters}
        onClearFilters={status ? () => setStatus('') : undefined}
        isLoading={isLoading}
        isError={isError}
        error={{
          title: 'Não foi possível carregar as campanhas',
          reason: 'A lista de campanhas não respondeu.',
          whatToDo: 'Verifique a conexão e tente novamente.',
        }}
        empty={{
          icon: Megaphone,
          title: 'Nenhuma campanha ainda',
          description: 'Crie a primeira campanha para começar a enviar mensagens.',
          action: (
            <Link href="/campaigns/new">
              <Button variant="primary" size="sm">
                <Plus className="size-4" />
                Nova campanha
              </Button>
            </Link>
          ),
        }}
      />
    </div>
  );
}
