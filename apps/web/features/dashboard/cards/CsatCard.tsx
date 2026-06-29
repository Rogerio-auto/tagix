'use client';

/**
 * Card de satisfação (CSAT) da Onda B (§F29 / AGENT_QUALITY_OBJECTIONS §5). Mostra o
 * sentimento médio (-100..100) + a distribuição promoter/neutral/detractor como uma
 * barra segmentada. A11y: cada segmento tem rótulo textual além da cor (UX §a11y) e
 * a barra tem `role=img` com aria-label resumido. Tokens DS, zero hex.
 */
import { cn } from '@/shared/lib/cn';
import type { DashboardCard } from '../types';
import { readCsatDistribution } from '../types';
import { csatSentimentLabel, formatInt } from '../format';

interface CsatCardProps {
  card: DashboardCard;
}

interface Segment {
  readonly key: 'promoters' | 'neutrals' | 'detractors';
  readonly label: string;
  readonly count: number;
  readonly barClass: string;
  readonly dotClass: string;
}

export function CsatCard({ card }: CsatCardProps): React.JSX.Element {
  const dist = readCsatDistribution(card.value);

  // Sem amostra → o card não deveria chegar aqui (value null filtrado no client);
  // defesa em profundidade: render mínimo coerente.
  if (!dist) {
    return (
      <div className="flex h-full flex-col justify-between rounded-lg border border-border bg-surface p-5">
        <span className="font-head text-sm font-medium text-text">{card.label}</span>
        <span className="mt-3 font-price text-2xl text-text">—</span>
      </div>
    );
  }

  const segments: Segment[] = [
    {
      key: 'promoters',
      label: 'Promotores',
      count: dist.promoters,
      barClass: 'bg-success',
      dotClass: 'bg-success',
    },
    {
      key: 'neutrals',
      label: 'Neutros',
      count: dist.neutrals,
      barClass: 'bg-border-2',
      dotClass: 'bg-border-2',
    },
    {
      key: 'detractors',
      label: 'Detratores',
      count: dist.detractors,
      barClass: 'bg-danger',
      dotClass: 'bg-danger',
    },
  ];
  const total = Math.max(1, dist.promoters + dist.neutrals + dist.detractors);
  const ariaLabel = `Promotores ${dist.promoters}, Neutros ${dist.neutrals}, Detratores ${dist.detractors}`;

  return (
    <div className="flex h-full flex-col justify-between rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <span className="font-head text-sm font-medium text-text">{card.label}</span>
        <span className="font-body text-xs text-text-low">{formatInt(dist.sample)} avaliações</span>
      </div>

      <span className="mt-3 font-price text-2xl text-text">{csatSentimentLabel(dist.sentiment)}</span>

      {/* Barra segmentada (proporção das 3 faixas). */}
      <div
        role="img"
        aria-label={ariaLabel}
        className="mt-3 flex h-2 w-full overflow-hidden rounded-pill bg-surface-2"
      >
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              className={cn('h-full', s.barClass)}
              style={{ width: `${(s.count / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>

      {/* Legenda textual (a11y: não depende só de cor). */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 font-body text-xs text-text-mid">
            <span className={cn('h-2 w-2 rounded-pill', s.dotClass)} aria-hidden="true" />
            {s.label}: <span className="font-price text-text">{formatInt(s.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
