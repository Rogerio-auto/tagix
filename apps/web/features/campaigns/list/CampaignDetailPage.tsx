'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Megaphone, SlidersHorizontal } from 'lucide-react';
import { Button, EmptyState, ErrorState, Skeleton } from '@hm/ui';
import { api, ApiError } from '@/shared/lib/api-client';
import { formatDate, formatNumber } from '@/shared/lib/locale';
import { CampaignMonitoring } from '../monitoring/CampaignMonitoring';
import { CampaignActions, CancelCampaignDialog, useCampaignPermissions } from './CampaignActions';
import { campaignKeys } from './queries';
import { CampaignStatusPill } from './status';
import type { Campaign, CampaignType } from './types';

interface CampaignDetail {
  campaign: Campaign;
}

const TYPE_LABEL: Record<CampaignType, string> = {
  broadcast: 'Disparo único',
  drip: 'Sequência',
  triggered: 'Por gatilho',
};

function BackLink(): React.JSX.Element {
  return (
    <Link
      href="/campaigns"
      className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm font-body text-sm text-text-low outline-none transition-colors duration-(--dur-fast) hover:text-text focus-visible:focus-ring"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Campanhas
    </Link>
  );
}

/**
 * Detalhe da campanha + monitoramento (CAMPAIGNS.md 12.6) no DS 3.0 (F72-S07).
 *
 * Cabeçalho editorial (nome, status, tipo e ritmo em mono) com as ações de escrita da
 * campanha: pausar, retomar, editar o rascunho e cancelar (com confirmação, UX §2.9).
 * No celular é aqui que essas ações moram (o card da lista é um botão inteiro).
 *
 * Estados (UX §2.7/§2.11): skeleton no formato final, 404 vira "não encontrada" com
 * caminho de volta, erro em 3 partes com "Tentar de novo".
 */
export function CampaignDetailPage({ campaignId }: { campaignId: string }): React.JSX.Element {
  const router = useRouter();
  const perms = useCampaignPermissions();
  const [toCancel, setToCancel] = useState<Campaign | null>(null);
  const query = useQuery({
    queryKey: campaignKeys.detail(campaignId),
    queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${campaignId}`),
  });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-6" aria-busy aria-label="Carregando campanha">
        <Skeleton className="h-11 w-32" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  const notFound =
    (query.isError && query.error instanceof ApiError && query.error.status === 404) ||
    (!query.isError && !query.data);

  if (notFound) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <EmptyState
          icon={Megaphone}
          title="Campanha não encontrada"
          description="Esta campanha não existe ou foi removida do workspace."
          action={
            <Button variant="secondary" onClick={() => router.push('/campaigns')}>
              Voltar para campanhas
            </Button>
          }
        />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState
          title="Não foi possível carregar a campanha"
          reason="O detalhe da campanha não respondeu."
          whatToDo="Verifique a conexão e tente novamente."
          action={
            <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  const { campaign } = query.data;
  const isDraft = campaign.status === 'draft';

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 wrap-break-word font-head text-h4 text-text md:text-h3">{campaign.name}</h1>
              <CampaignStatusPill status={campaign.status} />
            </div>
            <p className="mt-1.5 font-body text-small text-text-low">
              {TYPE_LABEL[campaign.type]} ·{' '}
              <span className="font-mono tabular-nums text-text-mid">
                {formatNumber(campaign.rateLimitPerMinute)}/min
              </span>{' '}
              · criada em <span className="font-mono tabular-nums text-text-mid">{formatDate(campaign.createdAt)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CampaignActions campaign={campaign} perms={perms} onCancel={setToCancel} size="md" />
            {!isDraft ? (
              <Button
                variant="ghost"
                leftIcon={<SlidersHorizontal className="size-4" aria-hidden />}
                onClick={() => router.push(`/campaigns/${campaign.id}/edit`)}
              >
                Ver configuração
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <CampaignMonitoring campaignId={campaign.id} />

      <CancelCampaignDialog campaign={toCancel} onClose={() => setToCancel(null)} />
    </div>
  );
}
