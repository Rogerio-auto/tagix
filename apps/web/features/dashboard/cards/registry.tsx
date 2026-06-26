'use client';

/**
 * Registry de cards por TIPO (DASHBOARD §9 — render server-driven). O servidor
 * decide QUAIS cards vêm e de que `cardType`; o front só mapeia tipo → componente.
 * **Não há `if (role)` aqui nem em lugar nenhum do dashboard** (anti-padrão v1 §10):
 * se o card chegou, é porque o role pode vê-lo.
 */
import type { ComponentType } from 'react';
import { lazyClient } from '@/shared/lib/lazy';
import { ChartSkeleton } from '@/shared/components/feedback';
import type { CardType, DashboardCard } from '../types';
import { StatCard } from './StatCard';
import { TableCard } from './TableCard';
import { LeaderboardCard } from './LeaderboardCard';
import { RecentLeadsCard } from './RecentLeadsCard';

/**
 * recharts é pesado e só aparece em cards `chart`. Carregamos o `ChartCard` (e a lib
 * recharts junto) sob demanda via `next/dynamic` (F10-S10): sai do First Load JS da
 * rota `/`. `ssr: false` evita mismatch de hidratação dos gráficos SVG; enquanto o
 * chunk baixa, o `ChartSkeleton` segura a forma do card (UX §3.6 — sem tela branca).
 */
const ChartCard = lazyClient<CardRenderProps>(
  () => import('./ChartCard').then((m) => m.ChartCard),
  { loading: () => <ChartSkeleton />, ssr: false },
);

/**
 * O `TimeSeriesCard` (F48-S07) também importa recharts. Mesmo tratamento do
 * `ChartCard`: lazy via `next/dynamic`, `ssr: false` (SVG não hidrata) e
 * `ChartSkeleton` segurando a forma enquanto o chunk baixa (UX §3.6).
 */
const TimeSeriesCard = lazyClient<CardRenderProps>(
  () => import('./TimeSeriesCard').then((m) => m.TimeSeriesCard),
  { loading: () => <ChartSkeleton />, ssr: false },
);

export interface CardRenderProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

// `ComponentType` (não a assinatura de função simples) porque o `ChartCard` é um
// boundary lazy de `next/dynamic` (F10-S10), cujo tipo de retorno cobre função e classe.
type CardComponent = ComponentType<CardRenderProps>;

/** Tipo → componente. `list` cai no Stat (lista compacta tratada no drawer). */
const REGISTRY: Record<CardType, CardComponent> = {
  stat: StatCard,
  chart: ChartCard,
  table: TableCard,
  list: StatCard,
  leaderboard: LeaderboardCard,
  feed: RecentLeadsCard,
  timeseries: TimeSeriesCard,
};

export function renderCard(card: DashboardCard, onDrill?: (card: DashboardCard) => void): React.JSX.Element {
  const Component = REGISTRY[card.cardType];
  return <Component card={card} onDrill={onDrill} />;
}
