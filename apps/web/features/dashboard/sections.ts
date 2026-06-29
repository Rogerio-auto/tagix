/**
 * Camada de apresentação do Dashboard v3 (F55-S06 / DASHBOARD §9). Substitui os 6
 * `tiers` por **seções editoriais** em coluna estilo Stripe (decisão travada do
 * founder): leitura calma de cima pra baixo, hierarquia por peso/tamanho.
 *
 *   (1) KPIs grandes no topo  →  (2) gráfico largo (Desempenho 30d)  →
 *   (3) tendências (gráficos)  →  (4) rankings & tabelas  →  (5) leads & métricas
 *
 * `buildSections` recebe a lista de cards JÁ filtrada por role (servidor) e JÁ
 * ordenada/escondida (`applyLayout`) e a classifica nas seções acima. **100%
 * server-driven** (DASHBOARD §10): não há `if (role)` aqui. O strip de KPIs apenas
 * REORDENA/DESTACA o que o servidor já autorizou — promove só as keys que chegaram
 * (uma key ausente não entra; nada é revelado). Por isso a curadoria de KPIs é uma
 * única ordem (workspace e agente não compartilham keys; a interseção com o payload
 * resolve o papel naturalmente).
 *
 * Função pura: mesma entrada → mesma saída, sem efeitos. Extensível — um card de tipo
 * futuro (S07: placar IA×humano, ROI, funil) cai numa seção sã sem quebrar a tela.
 */
import type { HelpKey } from '@/shared/lib/help-content';
import type { CardType, DashboardCard } from './types';

/**
 * Keys promovidas ao strip de KPIs, em ordem de prioridade visual. Workspace/SUP+
 * primeiro, depois as do AGENT — conjuntos disjuntos, então um único array curado
 * serve a todos os papéis (só promovemos o que veio no payload). Cap em `KPI_CAP`.
 */
const KPI_KEYS_ORDERED: readonly string[] = [
  // Workspace / SUPERVISOR+ — dinheiro e volume de negócio em destaque.
  'valor_convertido_workspace_mes',
  'valor_total_pipeline',
  'deals_fechados_ganho_mes',
  'conversoes_workspace_mes',
  // AGENT — a própria carga e resultado do atendente ("minha mesa").
  'minhas_conversas_abertas',
  'minha_fila_pendente',
  'resolvidas_hoje_por_mim',
  'conversoes_minhas_mes',
];

/** Máximo de KPIs no strip do topo — "poucos números que importam" (founder). */
const KPI_CAP = 4;

/** Identidade de cada seção editorial (ordem = ordem de leitura vertical). */
export type SectionId = 'kpis' | 'performance' | 'trends' | 'rankings' | 'feed' | 'secondary';

/**
 * Como a seção se desenha:
 *  - `kpis`    — strip de KPIs grandes (HeroCard), grade que colapsa para 1 coluna.
 *  - `feature` — UM card largo full-width (gráfico de destaque, ex.: Desempenho 30d).
 *  - `grid`    — grade de cards médios (gráficos / rankings), 1 → 2 colunas.
 *  - `stack`   — cards empilhados / mistos (feed de leads + métricas secundárias).
 */
export type SectionLayout = 'kpis' | 'feature' | 'grid' | 'stack';

export interface DashboardSection {
  readonly id: SectionId;
  /** Título da faixa (null = sem cabeçalho — o strip de KPIs abre a página). */
  readonly title: string | null;
  /** Chave do HelpPanel `?` ao lado do título (UX §2.5) — null quando não há. */
  readonly helpKey: HelpKey | null;
  readonly layout: SectionLayout;
  readonly cards: DashboardCard[];
}

/** Tipos de card que viram cartão de gráfico médio na seção "Tendências". */
const TREND_TYPES: ReadonlySet<CardType> = new Set<CardType>(['chart']);
/** Tipos de card que viram ranking/tabela na seção "Rankings & equipe". */
const RANKING_TYPES: ReadonlySet<CardType> = new Set<CardType>(['leaderboard', 'table']);

/**
 * Classifica a lista (já filtrada + ordenada) nas seções editoriais. Retorna apenas
 * as seções NÃO vazias, na ordem de leitura vertical (KPIs → desempenho → tendências
 * → rankings → leads/métricas). Pura, sem mutação da entrada.
 */
export function buildSections(cards: readonly DashboardCard[]): DashboardSection[] {
  // Índice por key para resolver o strip de KPIs na ordem curada (não na do payload).
  const byKey = new Map<string, DashboardCard>();
  for (const card of cards) {
    if (!byKey.has(card.key)) byKey.set(card.key, card);
  }

  const kpis: DashboardCard[] = [];
  const kpiKeys = new Set<string>();
  for (const key of KPI_KEYS_ORDERED) {
    if (kpis.length >= KPI_CAP) break;
    const card = byKey.get(key);
    if (card) {
      kpis.push(card);
      kpiKeys.add(key);
    }
  }

  const performance: DashboardCard[] = [];
  const trends: DashboardCard[] = [];
  const rankings: DashboardCard[] = [];
  const feed: DashboardCard[] = [];
  const secondary: DashboardCard[] = [];

  for (const card of cards) {
    if (card.cardType === 'timeseries') {
      performance.push(card);
    } else if (TREND_TYPES.has(card.cardType)) {
      trends.push(card);
    } else if (RANKING_TYPES.has(card.cardType)) {
      rankings.push(card);
    } else if (card.cardType === 'feed') {
      feed.push(card);
    } else if (card.cardType === 'stat' || card.cardType === 'list') {
      // KPIs promovidos não duplicam em secundário; o resto desce para métricas.
      if (!kpiKeys.has(card.key)) secondary.push(card);
    } else {
      // Tipo futuro/desconhecido (S07): nunca some da tela — vai para secundário.
      secondary.push(card);
    }
  }

  const all: DashboardSection[] = [
    { id: 'kpis', title: null, helpKey: null, layout: 'kpis', cards: kpis },
    {
      id: 'performance',
      title: 'Desempenho',
      helpKey: 'dashboard.overview',
      layout: 'feature',
      cards: performance,
    },
    { id: 'trends', title: 'Tendências', helpKey: null, layout: 'grid', cards: trends },
    {
      id: 'rankings',
      title: 'Rankings e equipe',
      helpKey: null,
      layout: 'grid',
      cards: rankings,
    },
    { id: 'feed', title: 'Leads e métricas', helpKey: null, layout: 'stack', cards: feed },
    { id: 'secondary', title: null, helpKey: null, layout: 'grid', cards: secondary },
  ];

  return all.filter((s) => s.cards.length > 0);
}

/** A seção `feed` e `secondary` são desenhadas juntas (leads à esquerda, métricas ao
 *  lado). Helper para o shell saber se há algo na faixa de baixo sem recomputar. */
export function hasAnySection(sections: readonly DashboardSection[]): boolean {
  return sections.length > 0;
}
