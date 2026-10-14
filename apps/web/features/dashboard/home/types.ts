/**
 * Payload da Home (`GET /api/dashboard/home?period=7d|30d|90d`, F72-S04). Espelha
 * `apps/api/src/services/dashboard/home-model.ts` (a fonte do contrato). O recorte por
 * papel é feito no servidor: aqui não há `if (role)`. O que a tela mostra de dono
 * (`journey`, `revenueSeries`, KPIs de dinheiro) só existe no payload de quem pode ver,
 * e custo de IA/infra não existe neste contrato para papel nenhum.
 */
import type { Role } from '@hm/shared';

export type HomeScope = 'workspace' | 'personal';

/** Janelas aceitas pela rota (dias). A tela envia `?period=<n>d`. */
export const HOME_PERIODS = [7, 30, 90] as const;
export type HomePeriodDays = (typeof HOME_PERIODS)[number];
export const DEFAULT_HOME_PERIOD: HomePeriodDays = 30;

export type HomeKpiKey =
  | 'revenue'
  | 'leads'
  | 'speed_to_lead'
  | 'conversions'
  | 'open_mine'
  | 'waiting_mine'
  | 'resolved_mine';

export type HomeKpiUnit = 'cents' | 'count' | 'seconds';

/** Base de um KPI de mediana: quantos responderam e quantos ficaram sem resposta. */
export interface HomeKpiSample {
  readonly answered: number;
  readonly unanswered: number;
}

export interface HomeKpi {
  readonly key: HomeKpiKey;
  readonly unit: HomeKpiUnit;
  /** `null` = sem dado no período. A tela mostra "—", nunca um zero inventado. */
  readonly value: number | null;
  /** Mesmo cálculo na janela anterior; `null` quando não há base de comparação. */
  readonly previous: number | null;
  /** `lower` quando cair é melhorar (speed-to-lead, fila). */
  readonly betterWhen: 'higher' | 'lower';
  readonly href: string;
  /** Só `speed_to_lead`: a amostra da janela atual. */
  readonly sample: HomeKpiSample | null;
}

export type HomeAttentionKind = 'waiting_sla' | 'deals_stalled' | 'channel_down' | 'media_failed';
export type HomeAttentionSeverity = 'critical' | 'warning' | 'info';

export interface HomeAttentionItem {
  readonly kind: HomeAttentionKind;
  readonly severity: HomeAttentionSeverity;
  readonly count: number;
  /** Só `waiting_sla`: minutos do mais antigo. */
  readonly oldestMinutes: number | null;
  /** Destino da ação direta (o servidor já resolve conversa única vs. fila). */
  readonly href: string;
  /** Entidade da ação (conversa mais antiga, negócio parado, canal caído, mídia). */
  readonly targetId: string | null;
}

export interface HomeJourney {
  readonly leads: number;
  readonly conversations: number;
  readonly booked: number;
  readonly won: number;
}

export interface HomeRevenuePoint {
  /** `YYYY-MM-DD` (UTC). */
  readonly day: string;
  readonly valueCents: number;
}

/** Janela atual e a anterior, contígua e do mesmo tamanho (ISO). Base do "o que mudou". */
export interface HomeWindow {
  readonly from: string;
  readonly to: string;
  readonly previousFrom: string;
  readonly previousTo: string;
}

export interface HomeThresholds {
  readonly slaMinutes: number;
  /** De onde veio a régua: regra de SLA do workspace ou o padrão da Home. */
  readonly slaSource: 'workspace_rule' | 'default';
  readonly stalledDays: number;
  readonly mediaFailedDays: number;
}

export interface HomePayload {
  readonly scope: HomeScope;
  readonly role: Role;
  readonly periodDays: HomePeriodDays;
  readonly window: HomeWindow;
  readonly thresholds: HomeThresholds;
  readonly kpis: readonly HomeKpi[];
  /** Ordenada por severidade (crítico primeiro). */
  readonly attention: readonly HomeAttentionItem[];
  /** Só `workspace`. */
  readonly journey: HomeJourney | null;
  /** Só `workspace` e só com ao menos um tipo de conversão configurado. */
  readonly revenueSeries: readonly HomeRevenuePoint[] | null;
  readonly serverTime: string;
}
