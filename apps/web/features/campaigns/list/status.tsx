import { StatusPill, type BadgeTone } from '@hm/ui';
import type { CampaignStatus } from './types';

/** Rótulo e tom de cada status de campanha (DS 3.0: `StatusPill`, tom semântico). */
export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: BadgeTone; live?: boolean }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  scheduled: { label: 'Agendada', tone: 'info' },
  running: { label: 'Em execução', tone: 'success', live: true },
  paused: { label: 'Pausada', tone: 'warning' },
  completed: { label: 'Concluída', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
};

/** Status da campanha. Só "em execução" pulsa: movimento contínuo apenas em estado vivo. */
export function CampaignStatusPill({ status }: { status: CampaignStatus }): React.JSX.Element {
  const meta = CAMPAIGN_STATUS[status];
  return (
    <StatusPill tone={meta.tone} size="sm" live={meta.live ?? false}>
      {meta.label}
    </StatusPill>
  );
}

/** A campanha ainda pode ser cancelada (nem concluída, nem já cancelada). */
export function isCancellable(status: CampaignStatus): boolean {
  return status !== 'cancelled' && status !== 'completed';
}
