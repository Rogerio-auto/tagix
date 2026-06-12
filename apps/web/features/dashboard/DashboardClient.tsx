'use client';

/**
 * Shell client do dashboard (F8-S03 / DASHBOARD.md §9.2). Carrega `/dashboard/me`,
 * escuta o socket e renderiza os cards via registry por tipo. **Server-driven**: a
 * lista de cards/alerts vem filtrada por role do servidor — não há `if (role)` aqui.
 *
 * Layout: alerts no topo, depois os cards agrupados por categoria, em grade. Cards
 * `chart`/`table` ocupam 2 colunas. Respeita o layout pessoal (esconder/reordenar)
 * vindo de `layoutPreferences` (S04 escreve; aqui só aplica).
 *
 * Drill-down: stat cards com `drillHref` navegam (Link). Cards com detalhe próprio
 * (chart/table e métricas pessoais) abrem o drawer lateral — nunca modal (§4).
 */
import { useMemo, useState } from 'react';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { HelpHint } from '@/shared/components/help';
import { SkeletonList } from '@/shared/components/feedback';
import { useDashboard } from './queries';
import { useDashboardSocket } from './useDashboardSocket';
import { AlertsBanner } from './AlertsBanner';
import { DrillDownDrawer } from './DrillDownDrawer';
import { CustomizeDashboardButton } from './customization';
import { cardSpan, renderCard } from './cards/registry';
import type { DashboardCard, MetricCategory } from './types';

const CATEGORY_LABEL: Record<MetricCategory, string> = {
  atendimento: 'Atendimento',
  pipeline: 'Pipeline',
  campanhas: 'Campanhas',
  agentes: 'Agentes IA',
  conversoes: 'Conversões',
  negocio: 'Negócio',
};

const CATEGORY_ORDER: MetricCategory[] = [
  'atendimento',
  'conversoes',
  'pipeline',
  'campanhas',
  'agentes',
  'negocio',
];

/** Métricas cujo drill-down é por drawer (têm detalhe compacto), não navegação. */
const DRAWER_METRICS = new Set([
  'volume_inbound_24h',
  'volume_outbound_24h',
  'conversoes_por_tipo',
  'inbox_por_departamento',
  'conversoes_minhas_mes',
]);

function applyLayout(
  cards: readonly DashboardCard[],
  hidden: readonly string[],
  order: readonly string[],
): DashboardCard[] {
  const hiddenSet = new Set(hidden);
  const visible = cards.filter((c) => !hiddenSet.has(c.key));
  if (order.length === 0) return visible;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...visible].sort(
    (a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function DashboardClient() {
  const { data, isLoading, isError } = useDashboard();
  const [drillCard, setDrillCard] = useState<DashboardCard | null>(null);

  const visibleKeys = useMemo(
    () => new Set((data?.cards ?? []).map((c) => c.key)),
    [data?.cards],
  );
  useDashboardSocket(visibleKeys);

  const grouped = useMemo(() => {
    if (!data) return [];
    const ordered = applyLayout(
      data.cards,
      data.layoutPreferences.hidden,
      data.layoutPreferences.order,
    );
    return CATEGORY_ORDER.map((category) => ({
      category,
      cards: ordered.filter((c) => c.category === category),
    })).filter((g) => g.cards.length > 0);
  }, [data]);

  const onDrill = (card: DashboardCard): void => setDrillCard(card);

  return (
    <>
      <div className="flex items-center justify-between">
        <PageHeader title="Dashboard" helpSlot={<HelpHint k="dashboard.overview" />} />
        {data && <CustomizeDashboardButton />}
      </div>
      {isLoading && <SkeletonList rows={6} />}
      {isError && (
        <div className="rounded-lg border border-border bg-surface p-8">
          <p className="font-body text-text-mid">Não foi possível carregar o dashboard.</p>
        </div>
      )}
      {data && (
        <div className="flex flex-col gap-8">
          <AlertsBanner alerts={data.alerts} />
          {grouped.length === 0 && (
            <div className="rounded-lg border border-border bg-surface p-8">
              <p className="font-body text-text-mid">Nenhuma métrica disponível ainda.</p>
            </div>
          )}
          {grouped.map((group) => (
            <section key={group.category} className="flex flex-col gap-3">
              <h2 className="font-head text-sm uppercase tracking-wide text-text-low">
                {CATEGORY_LABEL[group.category]}
              </h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {group.cards.map((card) => {
                  const wantsDrawer = DRAWER_METRICS.has(card.key);
                  return (
                    <div
                      key={card.key}
                      className={cardSpan(card.cardType) === 2 ? 'col-span-2' : 'col-span-1'}
                    >
                      {renderCard(card, wantsDrawer ? onDrill : undefined)}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <DrillDownDrawer card={drillCard} onClose={() => setDrillCard(null)} />
    </>
  );
}
