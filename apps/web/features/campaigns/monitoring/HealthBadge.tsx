'use client';

import { cn } from '@hm/ui';
import type { HealthStatus } from '../list/types';

const STYLES: Record<HealthStatus, { label: string; cls: string }> = {
  healthy: { label: 'Saudavel', cls: 'bg-success/15 text-success border-success/30' },
  warning: { label: 'Atencao', cls: 'bg-warn/15 text-warn border-warn/30' },
  critical: { label: 'Critico', cls: 'bg-danger/15 text-danger border-danger/30' },
};

/** Badge de saude da campanha (CAMPAIGNS.md 11). */
export function HealthBadge({ status }: { status: HealthStatus }): React.JSX.Element {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ',
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}
