'use client';

import { StatusPill, type BadgeTone } from '@hm/ui';
import type { HealthStatus } from '../list/types';

const META: Record<HealthStatus, { label: string; tone: BadgeTone }> = {
  healthy: { label: 'Saudável', tone: 'success' },
  warning: { label: 'Atenção', tone: 'warning' },
  critical: { label: 'Crítico', tone: 'danger' },
};

/** Saúde da campanha (CAMPAIGNS.md 11). O texto carrega o sentido; a cor só reforça. */
export function HealthBadge({ status }: { status: HealthStatus }): React.JSX.Element {
  const meta = META[status];
  return (
    <StatusPill tone={meta.tone} size="sm">
      {meta.label}
    </StatusPill>
  );
}
