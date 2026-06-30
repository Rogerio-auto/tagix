'use client';

/**
 * Shell client do Dashboard v3 (F55-S06 / DASHBOARD §9). Carrega `/dashboard/me`,
 * escuta o socket e renderiza os cards numa **coluna editorial estilo Stripe**
 * (decisão travada do founder — clareza > densidade):
 *
 *   (1) KPIs grandes no topo  →  (2) Desempenho (gráfico largo full-width)  →
 *   (3) Tendências  →  (4) Rankings e equipe  →  (5) Leads e métricas
 *
 * **Server-driven** (DASHBOARD §10): a lista de cards/alerts vem filtrada por role do
 * servidor — não há `if (role)` aqui. `buildSections` apenas REORDENA/agrupa o que o
 * servidor já autorizou (nunca revela card de role não autorizado). Respeita o layout
 * pessoal (esconder/reordenar) via `applyLayout` antes de montar as seções; seções
 * vazias não renderizam (UX §2.6).
 *
 * Estados (UX §2.7/§2.11/§2.6): loading = skeleton com a forma do shell; erro = 3 partes
 * (o quê / por quê / o que fazer) com ação de tentar de novo; vazio = convite com CTA.
 *
 * Drill-down: stat cards com `drillHref` navegam (Link). Cards com detalhe próprio
 * abrem o drawer lateral (desktop) / bottom-sheet (mobile) — nunca modal (UX §2.3).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  LineChart,
  RefreshCw,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@hm/ui';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { HelpHint } from '@/shared/components/help';
import { EmptyState, ErrorState, Skeleton, ChartSkeleton } from '@/shared/components/feedback';
import { useDashboard } from './queries';
import { useDashboardSocket } from './useDashboardSocket';
import { AlertsBanner } from './AlertsBanner';
import { DrillDownDrawer } from './DrillDownDrawer';
import { CustomizeDashboardButton } from './customization';
import { renderCard } from './cards/registry';
import { HeroCard } from './cards/HeroCard';
import { buildSections, type DashboardSection, type SectionId } from './sections';
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
  // §F48 Command Center: leaderboard de produtividade tem pódio detalhado.
  'leaderboard_produtividade',
]);

/** Ícone discreto por seção (apoia o título — UX §2.4 path de entrada óbvio). */
const SECTION_ICON: Partial<Record<SectionId, LucideIcon>> = {
  negocio: TrendingUp,
  performance: LineChart,
  trends: LineChart,
  rankings: Trophy,
  feed: Users,
};

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

/** Cabeçalho sóbrio de seção (uppercase calmo — sem acento neon; o verde é do KPI #1). */
function SectionHeader({ section }: { section: DashboardSection }) {
  if (!section.title) return null;
  const Icon = SECTION_ICON[section.id];
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={15} className="text-text-low" aria-hidden />}
      <h2 className="font-head text-sm font-semibold tracking-tight text-text-mid">
        {section.title}
      </h2>
      {section.helpKey && <HelpHint k={section.helpKey} />}
    </div>
  );
}

/** Grade interna de uma seção, conforme o `layout` (clareza editorial, muito respiro). */
function SectionCards({
  section,
  drawerHandler,
}: {
  section: DashboardSection;
  drawerHandler: (card: DashboardCard) => ((card: DashboardCard) => void) | undefined;
}) {
  // Strip de KPIs: HeroCard grande; o 1º card da PÁGINA recebe o único acento neon.
  if (section.layout === 'kpis') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {section.cards.map((card, i) => (
          <HeroCard key={card.key} card={card} accent={i === 0} onDrill={drawerHandler(card)} />
        ))}
      </div>
    );
  }
  // Gráfico de destaque: full-width, largo (founder: "gráfico largo").
  if (section.layout === 'feature') {
    return (
      <div className="grid grid-cols-1 gap-4">
        {section.cards.map((card) => (
          <div key={card.key}>{renderCard(card, drawerHandler(card))}</div>
        ))}
      </div>
    );
  }
  // Pilha (leads + métricas): coluna única calma, cada card com seu próprio respiro.
  if (section.layout === 'stack') {
    return (
      <div className="grid grid-cols-1 gap-4">
        {section.cards.map((card) => (
          <div key={card.key}>{renderCard(card, drawerHandler(card))}</div>
        ))}
      </div>
    );
  }
  // Grade média (tendências / rankings): 1 → 2 colunas.
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {section.cards.map((card) => (
        <div key={card.key}>{renderCard(card, drawerHandler(card))}</div>
      ))}
    </div>
  );
}

/** Skeleton com a forma do shell (UX §2.7/§3.6 — sem tela branca, sem CLS). */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-busy aria-label="Carregando dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-6 rounded-xl border border-border bg-surface-2 p-6">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <Skeleton className="mb-4 h-4 w-40" />
        <ChartSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <ChartSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardClient() {
  const router = useRouter();
  const { data, isLoading, isError, isFetching, refetch } = useDashboard();
  const [drillCard, setDrillCard] = useState<DashboardCard | null>(null);

  const visibleKeys = useMemo(() => new Set((data?.cards ?? []).map((c) => c.key)), [data?.cards]);
  useDashboardSocket(visibleKeys);

  const sections = useMemo(() => {
    if (!data) return null;
    const withData = data.cards.filter((c) => c.value !== null);
    const ordered = applyLayout(withData, data.layoutPreferences.hidden, data.layoutPreferences.order);
    return buildSections(ordered);
  }, [data]);

  const onDrill = (card: DashboardCard): void => setDrillCard(card);
  /** onDrill só quando o card tem detalhe por drawer; senão deixa a navegação nativa. */
  const drawerHandler = (card: DashboardCard) => (DRAWER_METRICS.has(card.key) ? onDrill : undefined);

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

      {isLoading && <DashboardSkeleton />}

      {isError && (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState
            title="Não foi possível carregar o dashboard"
            reason="A conexão com o servidor falhou ou expirou."
            whatToDo="Verifique sua conexão e tente novamente."
            action={
              <Button
                variant="secondary"
                loading={isFetching}
                leftIcon={<RefreshCw className="size-4" />}
                onClick={() => void refetch()}
              >
                Tentar de novo
              </Button>
            }
          />
        </div>
      )}

      {data && sections && (
        <div className="flex flex-col gap-12" data-tour-id="dashboard-grid">
          {/* Onboarding: checklist "Primeiros passos" — só ADMIN/OWNER, some quando
              tudo concluído ou dispensado (F43-S06). Auto-gated internamente. */}
          <SetupChecklist />
          <AlertsBanner alerts={data.alerts} />

          {sections.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface">
              <EmptyState
                icon={LayoutDashboard}
                title="Seu dashboard está pronto, faltam dados"
                description="As métricas aparecem aqui assim que houver atividade — conversas, conversões e negócios. Comece atendendo para ver os números ganharem vida."
                action={
                  <Button variant="primary" onClick={() => router.push('/conversations')}>
                    Ir para conversas
                  </Button>
                }
              />
            </div>
          ) : (
            sections.map((section) => (
              <section key={section.id} className="flex flex-col gap-4">
                <SectionHeader section={section} />
                <SectionCards section={section} drawerHandler={drawerHandler} />
              </section>
            ))
          )}
        </div>
      )}

      <DrillDownDrawer card={drillCard} onClose={() => setDrillCard(null)} />
    </>
  );
}
