/**
 * Modelo da Home (F72-S04 — DS3_ADOCAO.md, DASHBOARD.md §8): contrato do payload e as
 * funções PURAS que o montam a partir dos agregados. Nada aqui toca banco: quem vê o
 * quê é decidido por `buildHomePayload`, e é isso que os testes sem infra travam.
 *
 * ## Quem vê o quê (decidido AQUI, nunca na tela)
 *
 * - `scope: 'workspace'` (SUPERVISOR, ADMIN, OWNER): receita atribuída, leads novos,
 *   speed-to-lead e conversões da empresa, com o período anterior, mais a jornada e a
 *   série de receita.
 * - `scope: 'personal'` (AGENT, READONLY): só a fila do próprio membro. Nenhum valor em
 *   dinheiro, nenhuma métrica de dono, nenhuma série da empresa — mesmo que o chamador
 *   entregue os agregados da empresa por engano, a projeção os descarta.
 * - Conexão de canal caída só chega a quem tem `channel.connect` (ADMIN/OWNER): é quem
 *   consegue reconectar.
 * - **Custo de IA/infra não existe neste contrato, para papel nenhum** (regra do §07 da
 *   maquete). Quem pode agir sobre ele (ADMIN+) tem os cards próprios em
 *   `/dashboard/me`; a Home nunca o carrega.
 *
 * ## "Desde a última visita"
 *
 * Não existe dado de última visita no modelo. Não é inventado: "o que mudou" é o delta
 * contra a janela anterior, do mesmo tamanho.
 */
import { can, type Role } from '@hm/shared';

const DAY_MS = 86_400_000;

/** Janelas aceitas na Home. Deslizantes: mês-calendário compara 9 dias com 31 no dia 9. */
export const HOME_PERIOD_OPTIONS = [7, 30, 90] as const;
export type HomePeriodDays = (typeof HOME_PERIOD_OPTIONS)[number];
export const HOME_PERIOD_DAYS: HomePeriodDays = 30;

/**
 * Régua de "esperando demais" quando o workspace não tem regra de SLA ativa. É a mesma
 * da faixa "atenção" da Hoje (15 min). Com regra (`sla_rules.first_response_secs`), a
 * regra vence.
 */
export const HOME_DEFAULT_SLA_MINUTES = 15;
/** Negócio aberto sem movimento há mais que isto é "parado". */
export const HOME_STALLED_DEAL_DAYS = 7;
/** Mídia que falhou mais velha que isto já não é acionável. */
export const HOME_MEDIA_FAILED_DAYS = 7;
/** A partir daqui a espera é crítica: o lead já está fechando com o concorrente. */
const WAITING_CRITICAL_MINUTES = 60;

// ─── Contrato ────────────────────────────────────────────────────────────────

export type HomeScope = 'workspace' | 'personal';

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
  /** `null` = sem dado no período (a tela mostra "—", nunca zero inventado). */
  readonly value: number | null;
  /** Mesmo cálculo na janela anterior; `null` quando não há base de comparação. */
  readonly previous: number | null;
  /** `lower` para métricas em que cair é melhorar (speed-to-lead, fila). */
  readonly betterWhen: 'higher' | 'lower';
  readonly href: string;
  /** Só `speed_to_lead`: a amostra da janela atual (mediana sem base não convence). */
  readonly sample: HomeKpiSample | null;
}

export type HomeAttentionKind = 'waiting_sla' | 'deals_stalled' | 'channel_down' | 'media_failed';
export type HomeAttentionSeverity = 'critical' | 'warning' | 'info';

export interface HomeAttentionItem {
  readonly kind: HomeAttentionKind;
  readonly severity: HomeAttentionSeverity;
  readonly count: number;
  /** Só `waiting_sla`: minutos do mais antigo (a tela mostra "há 2h"). */
  readonly oldestMinutes: number | null;
  /** Destino da ação direta do item (rota do app). */
  readonly href: string;
  /**
   * Entidade da ação: a conversa mais antiga esperando, o negócio parado há mais tempo,
   * o canal caído (quando é um só) ou a conversa com a mídia mais recente que falhou.
   */
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
  /** Janela atual e anterior (mesmo tamanho) em ISO — base do "o que mudou". */
  readonly window: HomeWindow;
  /** Réguas dos itens de atenção — a tela cita os números que o servidor usou. */
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

// ─── Agregados (entrada da projeção) ─────────────────────────────────────────

export interface Pair {
  readonly current: number;
  readonly previous: number;
}

export interface SpeedToLeadStats {
  /** Mediana em segundos; `null` sem nenhuma conversa respondida. */
  readonly medianSeconds: number | null;
  readonly answered: number;
  readonly unanswered: number;
}

export interface WorkspaceAggregates {
  readonly hasConversionTypes: boolean;
  readonly revenueCents: Pair;
  readonly conversions: Pair;
  readonly leads: Pair;
  readonly speedToLead: { readonly current: SpeedToLeadStats; readonly previous: SpeedToLeadStats };
  readonly journey: HomeJourney;
  readonly revenueSeries: readonly HomeRevenuePoint[] | null;
}

export interface PersonalAggregates {
  readonly open: number;
  readonly waiting: number;
  readonly resolvedToday: number;
  readonly speedToLead: { readonly current: SpeedToLeadStats; readonly previous: SpeedToLeadStats };
}

export interface AttentionAggregates {
  readonly waiting: {
    readonly count: number;
    readonly oldestAt: Date | null;
    readonly oldestConversationId: string | null;
  };
  readonly stalledDeals: { readonly count: number; readonly oldestDealId: string | null };
  /** `null` quando não foi carregado (papel sem `channel.connect`). */
  readonly channelDown: {
    readonly count: number;
    readonly onlyChannelId: string | null;
    /** Há conexão Meta ativa com token vencido (integração parada sem ninguém ter pedido). */
    readonly metaLoginExpired: boolean;
  } | null;
  readonly mediaFailed: { readonly count: number; readonly latestConversationId: string | null };
}

export interface BuildHomeInput {
  readonly role: Role;
  readonly now: Date;
  readonly periodDays: HomePeriodDays;
  readonly sla: { readonly minutes: number; readonly source: HomeThresholds['slaSource'] };
  readonly workspace: WorkspaceAggregates | null;
  readonly personal: PersonalAggregates | null;
  readonly attention: AttentionAggregates;
}

// ─── Funções puras ───────────────────────────────────────────────────────────

export function homeScopeForRole(role: Role): HomeScope {
  return role === 'SUPERVISOR' || role === 'ADMIN' || role === 'OWNER' ? 'workspace' : 'personal';
}

/** Quem recebe o item "canal caído": quem pode reconectar. */
export function canSeeChannelHealth(role: Role): boolean {
  return can(role, 'channel.connect');
}

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/**
 * Janela atual `[now − days, now)` e a anterior, contígua e do MESMO tamanho
 * `[now − 2·days, now − days)`. Sem sobreposição: um evento cai em uma só.
 */
export function homeWindows(
  now: Date,
  days: HomePeriodDays,
): { readonly current: TimeWindow; readonly previous: TimeWindow } {
  const span = days * DAY_MS;
  const from = new Date(now.getTime() - span);
  const prevFrom = new Date(from.getTime() - span);
  return { current: { from, to: now }, previous: { from: prevFrom, to: from } };
}

/** `numeric`/`bigint` do driver chegam como string; `null`/lixo viram `null`. */
export function toFiniteNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Régua efetiva: a regra de SLA de 1ª resposta do workspace, se houver; senão o padrão. */
export function resolveSlaMinutes(firstResponseSecs: number | null | undefined): {
  readonly minutes: number;
  readonly source: HomeThresholds['slaSource'];
} {
  if (
    typeof firstResponseSecs === 'number' &&
    Number.isFinite(firstResponseSecs) &&
    firstResponseSecs > 0
  ) {
    return { minutes: Math.max(1, Math.ceil(firstResponseSecs / 60)), source: 'workspace_rule' };
  }
  return { minutes: HOME_DEFAULT_SLA_MINUTES, source: 'default' };
}

/**
 * Série diária de receita da janela, com os dias sem venda preenchidos com 0. De
 * `from` (dia UTC) até `to` (dia UTC) inclusive — o primeiro e o último dia são
 * parciais, mas omiti-los esconderia venda real.
 */
export function fillRevenueSeries(
  rows: readonly { readonly day: string; readonly valueCents: number }[],
  win: TimeWindow,
): HomeRevenuePoint[] {
  const byDay = new Map<string, number>();
  for (const r of rows)
    byDay.set(r.day.slice(0, 10), (byDay.get(r.day.slice(0, 10)) ?? 0) + r.valueCents);
  const start = Date.UTC(win.from.getUTCFullYear(), win.from.getUTCMonth(), win.from.getUTCDate());
  const end = Date.UTC(win.to.getUTCFullYear(), win.to.getUTCMonth(), win.to.getUTCDate());
  const points: HomeRevenuePoint[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    points.push({ day, valueCents: byDay.get(day) ?? 0 });
  }
  return points;
}

const SEVERITY_RANK: Record<HomeAttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

function buildAttention(input: BuildHomeInput): HomeAttentionItem[] {
  const { attention: a, now } = input;
  const items: HomeAttentionItem[] = [];

  if (a.waiting.count > 0) {
    const oldestMs = a.waiting.oldestAt?.getTime() ?? now.getTime();
    const oldestMinutes = Math.max(0, Math.floor((now.getTime() - oldestMs) / 60_000));
    const id = a.waiting.oldestConversationId;
    items.push({
      kind: 'waiting_sla',
      severity: oldestMinutes >= WAITING_CRITICAL_MINUTES ? 'critical' : 'warning',
      count: a.waiting.count,
      oldestMinutes,
      // Uma só: abre a conversa. Várias: a fila de abertas.
      href: a.waiting.count === 1 && id ? `/conversations/${id}` : '/conversations?status=open',
      targetId: id,
    });
  }

  if (a.stalledDeals.count > 0) {
    items.push({
      kind: 'deals_stalled',
      severity: 'warning',
      count: a.stalledDeals.count,
      oldestMinutes: null,
      href: '/pipeline',
      targetId: a.stalledDeals.oldestDealId,
    });
  }

  // Defesa em profundidade: mesmo que o agregado tenha sido carregado, só sai para
  // quem pode reconectar.
  const down = canSeeChannelHealth(input.role) ? a.channelDown : null;
  if (down && (down.count > 0 || down.metaLoginExpired)) {
    const total = down.count + (down.metaLoginExpired ? 1 : 0);
    items.push({
      kind: 'channel_down',
      severity: 'critical',
      count: total,
      oldestMinutes: null,
      // Só a conexão Meta vencida: a tela da Meta; havendo canal sem credencial, a de canais.
      href: down.count === 0 ? '/settings/meta' : '/settings/channels',
      targetId: down.count === 1 && !down.metaLoginExpired ? down.onlyChannelId : null,
    });
  }

  if (a.mediaFailed.count > 0) {
    const id = a.mediaFailed.latestConversationId;
    items.push({
      kind: 'media_failed',
      severity: 'info',
      count: a.mediaFailed.count,
      oldestMinutes: null,
      href: a.mediaFailed.count === 1 && id ? `/conversations/${id}` : '/conversations',
      targetId: id,
    });
  }

  // `sort` é estável: dentro da mesma severidade fica a ordem acima.
  return items.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}

function speedKpi(stl: PersonalAggregates['speedToLead']): HomeKpi {
  return {
    key: 'speed_to_lead',
    unit: 'seconds',
    value: stl.current.medianSeconds,
    // Sem resposta na janela anterior não há base: `null`, não zero.
    previous: stl.previous.answered > 0 ? stl.previous.medianSeconds : null,
    betterWhen: 'lower',
    href: '/conversations',
    sample: { answered: stl.current.answered, unanswered: stl.current.unanswered },
  };
}

function workspaceKpis(w: WorkspaceAggregates): HomeKpi[] {
  // Sem tipo de conversão configurado a receita não é "zero": é desconhecida.
  const typed = w.hasConversionTypes;
  return [
    {
      key: 'revenue',
      unit: 'cents',
      value: typed ? w.revenueCents.current : null,
      previous: typed ? w.revenueCents.previous : null,
      betterWhen: 'higher',
      href: '/conversions',
      sample: null,
    },
    {
      key: 'leads',
      unit: 'count',
      value: w.leads.current,
      previous: w.leads.previous,
      betterWhen: 'higher',
      href: '/contacts',
      sample: null,
    },
    speedKpi(w.speedToLead),
    {
      key: 'conversions',
      unit: 'count',
      value: typed ? w.conversions.current : null,
      previous: typed ? w.conversions.previous : null,
      betterWhen: 'higher',
      href: '/conversions',
      sample: null,
    },
  ];
}

function personalKpis(p: PersonalAggregates): HomeKpi[] {
  return [
    {
      key: 'waiting_mine',
      unit: 'count',
      value: p.waiting,
      previous: null,
      betterWhen: 'lower',
      href: '/conversations?status=open',
      sample: null,
    },
    {
      key: 'open_mine',
      unit: 'count',
      value: p.open,
      previous: null,
      betterWhen: 'lower',
      href: '/conversations?status=open',
      sample: null,
    },
    {
      key: 'resolved_mine',
      unit: 'count',
      value: p.resolvedToday,
      previous: null,
      betterWhen: 'higher',
      href: '/conversations',
      sample: null,
    },
    speedKpi(p.speedToLead),
  ];
}

/**
 * Monta o payload da Home pelo papel. É a ÚNICA porta de saída: o recorte vem do
 * papel, não de quais agregados chegaram. Faltar o agregado que o escopo exige é erro
 * de programação (falha alto, não devolve tela pela metade).
 */
export function buildHomePayload(input: BuildHomeInput): HomePayload {
  const scope = homeScopeForRole(input.role);
  const { current, previous } = homeWindows(input.now, input.periodDays);

  let kpis: HomeKpi[];
  let journey: HomeJourney | null = null;
  let revenueSeries: readonly HomeRevenuePoint[] | null = null;

  if (scope === 'workspace') {
    const w = input.workspace;
    if (!w) throw new Error('buildHomePayload: escopo workspace sem agregados da empresa');
    kpis = workspaceKpis(w);
    journey = { ...w.journey };
    revenueSeries =
      w.hasConversionTypes && w.revenueSeries ? w.revenueSeries.map((p) => ({ ...p })) : null;
  } else {
    const p = input.personal;
    if (!p) throw new Error('buildHomePayload: escopo pessoal sem agregados do membro');
    kpis = personalKpis(p);
  }

  return {
    scope,
    role: input.role,
    periodDays: input.periodDays,
    window: {
      from: current.from.toISOString(),
      to: current.to.toISOString(),
      previousFrom: previous.from.toISOString(),
      previousTo: previous.to.toISOString(),
    },
    thresholds: {
      slaMinutes: input.sla.minutes,
      slaSource: input.sla.source,
      stalledDays: HOME_STALLED_DEAL_DAYS,
      mediaFailedDays: HOME_MEDIA_FAILED_DAYS,
    },
    kpis,
    attention: buildAttention(input),
    journey,
    revenueSeries,
    serverTime: input.now.toISOString(),
  };
}
