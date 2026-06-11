'use client';

/**
 * Banner de alertas no topo do dashboard (DASHBOARD §3.2/§3.3 — "⚠ Alertas").
 * Os alertas já vêm filtrados por role do servidor (originam-se só de cards que o
 * role vê). Severidade pinta a borda; sem alertas → nada renderizado.
 */
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardAlert } from './types';

const SEVERITY_CLASS: Record<DashboardAlert['severity'], string> = {
  info: 'border-info/40 text-info',
  warning: 'border-warn/40 text-warn',
  critical: 'border-danger/50 text-danger',
};

export function AlertsBanner({ alerts }: { alerts: readonly DashboardAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Alertas do dashboard">
      {alerts.map((a) => (
        <div
          key={a.key}
          className={cn(
            'flex items-center gap-2 rounded-lg border bg-surface px-4 py-3',
            SEVERITY_CLASS[a.severity],
          )}
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span className="font-body text-sm text-text-mid">{a.message}</span>
        </div>
      ))}
    </div>
  );
}
