/**
 * Camada de apresentação do Command Center v2 (F48-S08 / DASHBOARD §9). Função pura
 * `buildTiers` que recebe a lista de cards JÁ filtrada por role (servidor) e JÁ
 * ordenada/escondida (`applyLayout`) e a classifica em tiers visuais:
 *
 *   hero → tendências (charts + série) → rankings/equipe → leads + métricas secundárias
 *
 * **100% server-driven** (DASHBOARD §10): não há `if (role)` aqui. O hero apenas
 * REORDENA e DESTACA o que o servidor já autorizou — promovendo só as keys que
 * chegaram (uma key ausente simplesmente não entra no hero; não revela nada). Por
 * isso a lista de hero por escopo é uma única ordem curada: workspace e agente não
 * compartilham keys, então a interseção com o payload resolve naturalmente o papel.
 */
import type { DashboardCard } from './types';

/**
 * Keys promovidas ao Hero, em ordem de prioridade visual. Workspace/SUP+ primeiro,
 * depois as do AGENT — como os conjuntos são disjuntos, um único array curado serve
 * para todos os papéis (só promovemos o que veio no payload). Cap em `HERO_CAP`.
 */
const HERO_KEYS_ORDERED: readonly string[] = [
  // Workspace / SUPERVISOR+ — dinheiro e volume de negócio em destaque.
  'valor_convertido_workspace_mes',
  'valor_total_pipeline',
  'deals_fechados_ganho_mes',
  'conversoes_workspace_mes',
  // AGENT — a própria carga e resultado do atendente.
  'minhas_conversas_abertas',
  'minha_fila_pendente',
  'resolvidas_hoje_por_mim',
  'conversoes_minhas_mes',
];

/** Máximo de cards no hero strip (grade de 4 colunas no desktop). */
const HERO_CAP = 4;

/** Tiers do command center; cada um é uma lista (vazia = tier não renderiza). */
export interface DashboardTiers {
  /** KPIs de destaque, grandes, no topo (ordem curada). */
  readonly hero: DashboardCard[];
  /** Gráficos de barras/pizza (cardType `chart`). */
  readonly charts: DashboardCard[];
  /** Séries temporais 30d (cardType `timeseries`). */
  readonly timeseries: DashboardCard[];
  /** Rankings de equipe: `leaderboard` + tabelas de ranking (`table`). */
  readonly leaderboards: DashboardCard[];
  /** Feed de leads recentes (cardType `feed`). */
  readonly feeds: DashboardCard[];
  /** Métricas numéricas secundárias (cardType `stat`/`list` não promovidas ao hero). */
  readonly secondary: DashboardCard[];
}

/**
 * Classifica a lista (já filtrada + ordenada) nos tiers do Command Center. Pura:
 * mesma entrada → mesma saída, sem efeitos. Cards `chart`/`timeseries`/`leaderboard`/
 * `table`/`feed` vão para seus tiers; `stat`/`list` são candidatos a hero (pela ordem
 * curada, cap 4) e o restante desce para `secondary`.
 */
export function buildTiers(cards: readonly DashboardCard[]): DashboardTiers {
  // Índice por key para resolver o hero na ordem curada (não na ordem do payload).
  const byKey = new Map<string, DashboardCard>();
  for (const card of cards) {
    if (!byKey.has(card.key)) byKey.set(card.key, card);
  }

  const hero: DashboardCard[] = [];
  const heroKeys = new Set<string>();
  for (const key of HERO_KEYS_ORDERED) {
    if (hero.length >= HERO_CAP) break;
    const card = byKey.get(key);
    if (card) {
      hero.push(card);
      heroKeys.add(key);
    }
  }

  const charts: DashboardCard[] = [];
  const timeseries: DashboardCard[] = [];
  const leaderboards: DashboardCard[] = [];
  const feeds: DashboardCard[] = [];
  const secondary: DashboardCard[] = [];

  for (const card of cards) {
    switch (card.cardType) {
      case 'chart':
        charts.push(card);
        break;
      case 'timeseries':
        timeseries.push(card);
        break;
      case 'leaderboard':
      case 'table':
        leaderboards.push(card);
        break;
      case 'feed':
        feeds.push(card);
        break;
      case 'stat':
      case 'list':
        if (!heroKeys.has(card.key)) secondary.push(card);
        break;
      default:
        // Tipo desconhecido (futuro) cai em secundário para não sumir da tela.
        secondary.push(card);
    }
  }

  return { hero, charts, timeseries, leaderboards, feeds, secondary };
}
