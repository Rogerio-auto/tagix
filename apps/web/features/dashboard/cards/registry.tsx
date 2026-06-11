'use client';

/**
 * Registry de cards por TIPO (DASHBOARD §9 — render server-driven). O servidor
 * decide QUAIS cards vêm e de que `cardType`; o front só mapeia tipo → componente.
 * **Não há `if (role)` aqui nem em lugar nenhum do dashboard** (anti-padrão v1 §10):
 * se o card chegou, é porque o role pode vê-lo.
 */
import type { CardType, DashboardCard } from '../types';
import { StatCard } from './StatCard';
import { ChartCard } from './ChartCard';
import { TableCard } from './TableCard';

export interface CardRenderProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

type CardComponent = (props: CardRenderProps) => React.JSX.Element;

/** Tipo → componente. `list` cai no Stat (lista compacta tratada no drawer). */
const REGISTRY: Record<CardType, CardComponent> = {
  stat: StatCard,
  chart: ChartCard,
  table: TableCard,
  list: StatCard,
};

/** Cards `chart`/`table` ocupam 2 colunas; `stat`/`list` ocupam 1. */
export function cardSpan(cardType: CardType): 1 | 2 {
  return cardType === 'chart' || cardType === 'table' ? 2 : 1;
}

export function renderCard(card: DashboardCard, onDrill?: (card: DashboardCard) => void): React.JSX.Element {
  const Component = REGISTRY[card.cardType];
  return <Component card={card} onDrill={onDrill} />;
}
