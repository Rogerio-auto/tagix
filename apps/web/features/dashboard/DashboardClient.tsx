'use client';

/**
 * Shell client do Dashboard — Command Center v2 (F48-S08 / DASHBOARD §9). Carrega
 * `/dashboard/me`, escuta o socket e renderiza os cards em TIERS de hierarquia:
 *
 *   Hero (KPIs grandes) → Tendências (gráficos + série) → Rankings & equipe →
 *   Leads recentes + métricas secundárias
 *
 * **Server-driven** (DASHBOARD §10): a lista de cards/alerts vem filtrada por role do
 * servidor — não há `if (role)` aqui. O hero apenas REORDENA/destaca o que o servidor
 * já autorizou (`buildTiers`), nunca revela card de role não autorizado.
 *
 * Respeita o layout pessoal (esconder/reordenar) via `applyLayout` (S04 escreve; aqui
 * só aplica) ANTES de montar os tiers. Tiers vazios não renderizam (UX §2.6).
 *
 * Drill-down: stat cards com `drillHref` navegam (Link). Cards com detalhe próprio
 * (chart/table/leaderboard e métricas pessoais) abrem o drawer lateral — nunca modal
 * (UX §2.3 / §4).
 */
import { useMemo, useState } from 'react';
import { BarChart3, LineChart, Trophy, Users, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { HelpHint } from '@/shared/components/help';
import { SkeletonList } from '@/shared/components/feedback';
import { useDashboard } from './queries';
import { useDashboardSocket } from './useDashboardSocket';
import { AlertsBanner } from './AlertsBanner';
import { DrillDownDrawer } from './DrillDownDrawer';
import { CustomizeDashboardButton } from './customization';
import { renderCard } from './cards/registry';
import { HeroCard } from './cards/HeroCard';
import { buildTiers } from './presentation';
import { SetupChecklist } from '@/features/onboarding/checklist';
import type { DashboardCard } from './types';

/** Métricas cujo drill-down é por drawer (têm detalhe compacto), não navegação. */
const DRAWER_METRICS = new Set([
  'volume_inbound_24h',
  'volume_outbound_24h',
  'conversoes_por_tipo',
  'inbox_por_departamento',
  'conversoes_minhas_mes',
  // Onda A (F28): tabelas column-aware com detalhe + link por linha no drawer.
  'performance_por_atendente',
  'inbox_por_canal',
  'tokens_por_modelo_24h',
  'conversoes_por_atendente_humano',
  'conversoes_por_agente_ia',
  // Onda B (F29): rankings de qualidade + objeções rankeadas abrem drawer.
  'qualidade_por_agente',
  'qualidade_por_atendente',
  'objecoes_rankeadas',
  // §F48 Command Center v2: leaderboard de produtividade tem pódio detalhado.
  'leaderboard_produtividade',
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
    (a, b) =>
      (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Cabeçalho discreto de tier (uppercase, sóbrio — sem acento neon; o verde é do hero). */
function TierLabel({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <div className="flex items-center gap-2 border-l-2 border-border pl-3">
      <Icon size={14} className="text-text-low" />
      <h2 className="font-head text-xs font-semibold uppercase tracking-widest text-text-low">
        {children}
      </h2>
    </div>
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

  const tiers = useMemo(() => {
    if (!data) return null;
    const withData = data.cards.filter((c) => c.value !== null);
    const ordered = applyLayout(
      withData,
      data.layoutPreferences.hidden,
      data.layoutPreferences.order,
    );
    return buildTiers(ordered);
  }, [data]);

  const onDrill = (card: DashboardCard): void => setDrillCard(card);
  /** onDrill só quando o card tem detalhe por drawer; senão deixa a navegação nativa. */
  const drawerHandler = (card: DashboardCard) =>
    DRAWER_METRICS.has(card.key) ? onDrill : undefined;

  const isEmpty =
    tiers !== null &&
    tiers.hero.length === 0 &&
    tiers.charts.length === 0 &&
    tiers.timeseries.length === 0 &&
    tiers.leaderboards.length === 0 &&
    tiers.feeds.length === 0 &&
    tiers.secondary.length === 0;

  return (
    <>
      <div className="flex items-center justify-between" data-tour-id="dashboard-header">
        <PageHeader title="Dashboard" helpSlot={<HelpHint k="dashboard.overview" />} />
        {data && (
          <span data-tour-id="dashboard-customize">
            <CustomizeDashboardButton />
          </span>
        )}
      </div>
      {isLoading && <SkeletonList rows={6} />}
      {isError && (
        <div className="rounded-lg border border-border bg-surface p-8">
          <p className="font-body text-text-mid">Não foi possível carregar o dashboard.</p>
        </div>
      )}
      {data && tiers && (
        <div className="flex flex-col gap-10" data-tour-id="dashboard-grid">
          {/* Onboarding: checklist "Primeiros passos" — só ADMIN/OWNER, some quando
              tudo concluído ou dispensado (F43-S06). Auto-gated internamente. */}
          <SetupChecklist />
          <AlertsBanner alerts={data.alerts} />

          {isEmpty && (
            <div className="rounded-lg border border-border bg-surface p-8">
              <p className="font-body text-text-mid">Nenhuma métrica disponível ainda.</p>
            </div>
          )}

          {/* Tier 1 — Hero strip: KPIs de destaque. O 1º card recebe o único acento
              neon da tela (regra DS "1 verde por tela"). */}
          {tiers.hero.length > 0 && (
            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {tiers.hero.map((card, i) => (
                <HeroCard
                  key={card.key}
                  card={card}
                  accent={i === 0}
                  onDrill={drawerHandler(card)}
                />
              ))}
            </section>
          )}

          {/* Tier 2 — Tendências: gráficos + série temporal (cards largos). */}
          {(tiers.charts.length > 0 || tiers.timeseries.length > 0) && (
            <section className="flex flex-col gap-4">
              <TierLabel icon={LineChart}>Tendências</TierLabel>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[...tiers.charts, ...tiers.timeseries].map((card) => (
                  <div key={card.key}>{renderCard(card, drawerHandler(card))}</div>
                ))}
              </div>
            </section>
          )}

          {/* Tier 3 — Rankings & equipe: leaderboard + tabelas de ranking. */}
          {tiers.leaderboards.length > 0 && (
            <section className="flex flex-col gap-4">
              <TierLabel icon={Trophy}>Rankings & equipe</TierLabel>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {tiers.leaderboards.map((card) => (
                  <div key={card.key}>{renderCard(card, drawerHandler(card))}</div>
                ))}
              </div>
            </section>
          )}

          {/* Tier 4 — Leads recentes + métricas secundárias (grade compacta). O feed
              ocupa uma coluna mais alta no desktop; os stats fluem ao lado. */}
          {(tiers.feeds.length > 0 || tiers.secondary.length > 0) && (
            <section className="flex flex-col gap-4">
              <TierLabel icon={tiers.feeds.length > 0 ? Users : BarChart3}>
                {tiers.feeds.length > 0 ? 'Leads & métricas' : 'Métricas'}
              </TierLabel>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {tiers.feeds.map((card) => (
                  <div
                    key={card.key}
                    className="col-span-2 sm:col-span-3 lg:col-span-1 lg:row-span-2"
                  >
                    {renderCard(card, drawerHandler(card))}
                  </div>
                ))}
                {tiers.secondary.map((card) => (
                  <div key={card.key}>{renderCard(card, drawerHandler(card))}</div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <DrillDownDrawer card={drillCard} onClose={() => setDrillCard(null)} />
    </>
  );
}
