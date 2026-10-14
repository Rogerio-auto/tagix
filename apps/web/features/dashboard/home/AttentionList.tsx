'use client';

/**
 * "Precisa da sua atenção". Cada linha é uma decisão com ação direta (clique no corpo,
 * UX §2.1) e o servidor já entregou só o que este papel pode resolver (conexão de
 * canal caída só chega a quem reconecta; custo de IA não passa por aqui).
 *
 * A severidade nunca é só a cor: o ponto vem com anel, a linha traz o tempo mais antigo
 * e o texto diz o que está errado. Vazio é uma boa notícia, escrita como tal.
 */
import type * as React from 'react';
import { useId } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Badge } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { alertCopy, alertHref, attentionCopy } from './home-format';
import { Panel } from './Panel';
import type { DashboardAlert } from '../types';
import type { HomeAttentionItem, HomePayload } from './types';

type Severity = HomeAttentionItem['severity'];

export interface AttentionRow {
  readonly key: string;
  /** Entidade da ação (conversa, negócio, canal), quando o servidor a identificou. */
  readonly targetId: string | null;
  readonly severity: Severity;
  readonly title: string;
  readonly context: string;
  readonly action: string;
  readonly time: string | null;
  readonly href: string;
}

const DOT: Record<Severity, string> = {
  critical: 'bg-danger ring-danger/25',
  warning: 'bg-warn ring-warn/25',
  info: 'bg-info ring-info/25',
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const ALERT_SEVERITY: Record<DashboardAlert['severity'], Severity> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

/** Itens do servidor (`/home`) e alertas de `/me` (SLA, orçamento de IA) numa lista só. */
export function buildAttentionRows(
  items: readonly HomeAttentionItem[],
  thresholds: HomePayload['thresholds'],
  alerts: readonly DashboardAlert[],
): AttentionRow[] {
  const fromHome: AttentionRow[] = items.map((item) => ({
    key: item.kind,
    targetId: item.targetId,
    severity: item.severity,
    href: item.href,
    ...attentionCopy(item, thresholds),
  }));
  const fromAlerts: AttentionRow[] = alerts.map((a) => ({
    key: `alert:${a.key}`,
    targetId: null,
    severity: ALERT_SEVERITY[a.severity],
    title: a.message,
    ...alertCopy(a),
    time: null,
    href: alertHref(a),
  }));
  return [...fromHome, ...fromAlerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

export function AttentionList({
  rows,
  className,
}: {
  rows: readonly AttentionRow[];
  className?: string;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <Panel
      id={titleId}
      eyebrow="Agora"
      title="Precisa da sua atenção"
      className={className}
      aside={
        rows.length > 0 ? (
          <Badge tone="neutral" size="sm" className="font-mono tabular-nums">
            {rows.length} {rows.length === 1 ? 'item' : 'itens'}
          </Badge>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-8 sm:px-6">
          <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
          <div>
            <p className="font-body text-sm font-bold text-text">Tudo em dia.</p>
            <p className="font-body text-sm text-text-low">Nada pede você agora.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                data-attention={row.key}
                data-target-id={row.targetId ?? undefined}
                className="group flex min-h-16 items-start gap-3 px-4 py-3.5 -outline-offset-2 hover:bg-surface-2 focus-visible:focus-ring motion-safe:transition-colors sm:px-6"
              >
                {/* Alinhado à 1ª linha do título, não ao centro do bloco. */}
                <span
                  aria-hidden
                  className={cn('mt-1.5 size-2 shrink-0 rounded-pill ring-4', DOT[row.severity])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-balance font-body text-sm font-bold leading-snug text-text">
                    {row.title}
                  </span>
                  <span className="mt-0.5 block font-body text-sm text-text-low">
                    {row.context}
                  </span>
                </span>
                {/* Coluna estreita: o tempo em mono em cima, o verbo da ação embaixo. */}
                <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                  {row.time !== null && (
                    <span className="font-mono text-xs tabular-nums text-text-mid">{row.time}</span>
                  )}
                  <span className="inline-flex items-center gap-0.5 font-body text-xs font-bold text-text-mid group-hover:text-text motion-safe:transition-colors">
                    {row.action}
                    <ChevronRight
                      aria-hidden
                      className="size-3.5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                    />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
