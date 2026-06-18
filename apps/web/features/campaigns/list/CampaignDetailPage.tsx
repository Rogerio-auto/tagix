'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { CampaignMonitoring } from '../monitoring/CampaignMonitoring';
import { campaignKeys } from './queries';
import type { Campaign } from './types';

interface CampaignDetail {
  campaign: Campaign;
}

/** Detalhe da campanha + painel de monitoramento (CAMPAIGNS.md 12.6). */
export function CampaignDetailPage({ campaignId }: { campaignId: string }): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: campaignKeys.detail(campaignId),
    queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${campaignId}`),
  });

  if (isLoading) return <p className="p-6 text-sm text-text-low">Carregando…</p>;
  if (!data) return <p className="p-6 text-sm text-text-low">Campanha nao encontrada.</p>;

  const { campaign } = data;
  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/campaigns" className="text-xs text-text-low hover:text-text">
            ← Campanhas
          </Link>
          <h1 className="font-head text-lg font-semibold text-text">{campaign.name}</h1>
        </div>
        <Link
          href={`/campaigns/${campaign.id}/edit`}
          className="touch-target inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm text-text outline-none transition-colors hover:bg-surface-2 focus-visible:shadow-glow-md"
        >
          Editar
        </Link>
      </header>
      <CampaignMonitoring campaignId={campaign.id} status={campaign.status} />
    </div>
  );
}
