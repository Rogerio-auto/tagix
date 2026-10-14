/**
 * Apresentação da Home: texto, delta e geometria do gráfico. Tudo puro (sem React),
 * então testável. Moeda, inteiro e duração reusam `../format` — nenhum locale ou
 * moeda literal novo; datas e porcentagens usam o locale do navegador (`undefined`).
 */
import { formatBRLFromCents, formatDuration, formatInt } from '../format';
import type { DashboardAlert } from '../types';
import {
  DEFAULT_HOME_PERIOD,
  HOME_PERIODS,
  type HomeAttentionItem,
  type HomeKpi,
  type HomeKpiKey,
  type HomePayload,
  type HomePeriodDays,
  type HomeRevenuePoint,
} from './types';

/** Espaços inquebráveis que o `Intl` põe na moeda (U+00A0, U+202F). */
const NBSP = /[\u00a0\u202f]/g;

/**
 * Espa\u00e7o inquebr\u00e1vel entre n\u00famero e unidade ("15 min", "30 dias"): numa coluna
 * estreita a unidade nunca fica \u00f3rf\u00e3 na linha de baixo.
 */
export const UNIT_SPACE = '\u00a0';

// ─── Saudação ────────────────────────────────────────────────────────────────

export function greetingForHour(hour: number): string {
  if (hour < 5) return 'Boa madrugada';
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Primeiro nome para a saudação; vazio quando a sessão ainda não trouxe nome. */
export function firstName(full: string | null | undefined): string {
  const trimmed = (full ?? '').trim();
  if (trimmed === '') return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

// ─── KPIs ────────────────────────────────────────────────────────────────────

export const KPI_LABEL: Record<HomeKpiKey, string> = {
  revenue: 'Receita atribuída',
  leads: 'Leads novos',
  speed_to_lead: 'Speed to lead',
  conversions: 'Conversões',
  open_mine: 'Em andamento',
  waiting_mine: 'Esperando você',
  resolved_mine: 'Resolvidas hoje',
};

/** Linha de contexto sob o rótulo: o que o número mede, sem jargão. */
export const KPI_CAPTION: Record<HomeKpiKey, string> = {
  revenue: 'Conversões com valor',
  leads: 'Contatos que entraram',
  speed_to_lead: 'Mediana até a 1ª resposta',
  conversions: 'Confirmadas no período',
  open_mine: 'Atribuídas a você',
  waiting_mine: 'O contato falou por último',
  resolved_mine: 'Encerradas por você',
};

/** Velocidade em relógio: "00:41". Acima de 1h, "1h 05m". Sem amostra, "—". */
export function formatSpeed(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Reais inteiros: o centavo é ruído numa manchete de 30 dias. */
export function formatRevenue(cents: number): string {
  const whole = Math.round(cents / 100) * 100;
  return formatBRLFromCents(whole).replace(NBSP, ' ').replace(/,00$/, '');
}

export function formatKpiValue(kpi: Pick<HomeKpi, 'unit' | 'value'>): string {
  if (kpi.value === null) return '—';
  if (kpi.unit === 'cents') return formatRevenue(kpi.value);
  if (kpi.unit === 'seconds') return formatSpeed(kpi.value);
  return formatInt(kpi.value);
}

export interface KpiDelta {
  readonly direction: 'up' | 'down' | 'flat' | 'none';
  /** Bom/ruim para o negócio, não "subiu/desceu": speed-to-lead caindo é bom. */
  readonly tone: 'good' | 'bad' | 'neutral';
  readonly text: string;
}

const NO_DELTA: KpiDelta = { direction: 'none', tone: 'neutral', text: '' };

function pctText(pct: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(pct);
}

export function kpiDelta(kpi: HomeKpi): KpiDelta {
  const { value, previous } = kpi;
  if (value === null || previous === null) return NO_DELTA;

  if (kpi.unit === 'seconds') {
    const diff = value - previous;
    if (Math.abs(diff) < 1) {
      return { direction: 'flat', tone: 'neutral', text: 'Igual ao anterior' };
    }
    const faster = diff < 0;
    const improved = kpi.betterWhen === 'lower' ? faster : !faster;
    return {
      direction: faster ? 'down' : 'up',
      tone: improved ? 'good' : 'bad',
      text: `${formatDuration(Math.abs(diff))} ${faster ? 'mais rápido' : 'mais lento'}`,
    };
  }

  if (previous === 0) {
    return value === 0
      ? { direction: 'flat', tone: 'neutral', text: 'Igual ao anterior' }
      : { direction: 'up', tone: 'neutral', text: 'Sem base anterior' };
  }

  const pct = ((value - previous) / previous) * 100;
  if (Math.round(pct * 10) === 0) {
    return { direction: 'flat', tone: 'neutral', text: 'Igual ao anterior' };
  }
  const up = pct > 0;
  const improved = kpi.betterWhen === 'higher' ? up : !up;
  return {
    direction: up ? 'up' : 'down',
    tone: improved ? 'good' : 'bad',
    text: `${pctText(pct)}% vs. anterior`,
  };
}

// ─── Janela e amostra ────────────────────────────────────────────────────────

/**
 * Janela inicial da Home a partir do "Período padrão" salvo na personalização (F8,
 * `layoutPreferences.period`). A Home só tem janelas deslizantes de 7/30/90 dias; o
 * que não for uma delas (`mtd`, `ytd`, nada salvo) abre em 30 dias, sem tocar no
 * que está salvo.
 */
export function periodFromPreference(pref: string | null | undefined): HomePeriodDays {
  const match = /^(\d+)d$/.exec(pref ?? '');
  const days = match ? Number(match[1]) : NaN;
  return HOME_PERIODS.find((p) => p === days) ?? DEFAULT_HOME_PERIOD;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

/**
 * Rótulo da janela de comparação: "vs. 15 de ago. – 14 de set.". As janelas são
 * deslizantes e contíguas (`[now − 2d, now − d)`), do mesmo tamanho da atual.
 */
export function comparisonLabel(win: HomePayload['window']): string {
  return `vs. ${shortDate(win.previousFrom)} – ${shortDate(win.previousTo)}`;
}

/**
 * Base da mediana do speed-to-lead. Mediana sem base não convence: "00:41" de 2
 * conversas é anedota, de 200 é processo. Quem ficou sem resposta também aparece.
 */
export function sampleText(sample: HomeKpi['sample']): string | null {
  if (sample === null) return null;
  const { answered, unanswered } = sample;
  if (answered === 0 && unanswered === 0) return 'Nenhuma conversa nova no período';
  const base =
    answered === 0
      ? 'Nenhuma respondida'
      : `${formatInt(answered)} ${answered === 1 ? 'respondida' : 'respondidas'}`;
  return unanswered > 0 ? `${base} · ${formatInt(unanswered)} sem resposta` : base;
}

// ─── Manchete: "o que mudou" ─────────────────────────────────────────────────

function kpiOf(payload: HomePayload, key: HomeKpiKey): HomeKpi | undefined {
  return payload.kpis.find((k) => k.key === key);
}

/** Variação percentual inteira, ou `null` quando não há base honesta para comparar. */
function pctChange(k: HomeKpi | undefined): number | null {
  if (!k || k.value === null || k.previous === null || k.previous <= 0) return null;
  const pct = Math.round(((k.value - k.previous) / k.previous) * 100);
  return pct === 0 ? null : pct;
}

/**
 * A frase que responde "o que mudou?" — sempre contra a janela anterior do mesmo
 * tamanho (o servidor não tem "última visita", e a tela não a inventa). Honesta nos
 * dois sentidos: se a receita caiu, a manchete diz que caiu. Sem comparação possível,
 * não finge: diz o volume.
 */
export function buildHeadline(payload: HomePayload): string {
  const days = payload.periodDays;

  if (payload.scope === 'personal') {
    const waiting = kpiOf(payload, 'waiting_mine')?.value ?? 0;
    const open = kpiOf(payload, 'open_mine')?.value ?? 0;
    if (waiting > 0) {
      return waiting === 1
        ? 'Uma conversa espera por você.'
        : `${formatInt(waiting)} conversas esperam por você.`;
    }
    if (open > 0) return 'Ninguém esperando. Sua fila está sob controle.';
    return 'Sua fila está vazia.';
  }

  const leadsKpi = kpiOf(payload, 'leads');
  const leads = leadsKpi?.value ?? 0;
  const leadsText =
    leads > 0
      ? ` ${leads === 1 ? '1 lead novo entrou' : `${formatInt(leads)} leads novos entraram`}.`
      : '';

  const revenuePct = pctChange(kpiOf(payload, 'revenue'));
  if (revenuePct !== null) {
    const verb = revenuePct > 0 ? 'subiu' : 'caiu';
    return `A receita atribuída ${verb} ${Math.abs(revenuePct)}% em ${days}${UNIT_SPACE}dias.${leadsText}`;
  }
  if (leads > 0) {
    const volume = `${leads === 1 ? '1 lead novo' : `${formatInt(leads)} leads novos`} em ${days}${UNIT_SPACE}dias`;
    const leadsPct = pctChange(leadsKpi);
    if (leadsPct !== null) {
      return `${volume}, ${Math.abs(leadsPct)}% ${leadsPct > 0 ? 'a mais' : 'a menos'} que no período anterior.`;
    }
    return `${volume}.`;
  }
  return 'Os números aparecem aqui assim que houver atividade.';
}

/** Vazio de verdade: empresa nova, nada a mostrar além do convite. */
export function isHomeEmpty(payload: HomePayload): boolean {
  if (payload.attention.length > 0) return false;
  if (payload.journey) {
    const j = payload.journey;
    if (j.leads + j.conversations + j.booked + j.won > 0) return false;
  }
  return payload.kpis.every((k) => k.value === null || k.value === 0);
}

// ─── Atenção ─────────────────────────────────────────────────────────────────

export interface AttentionCopy {
  readonly title: string;
  readonly context: string;
  readonly action: string;
  /** Coluna mono à direita ("2 h"), quando há tempo a mostrar. */
  readonly time: string | null;
}

function plural(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

function shortMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}${UNIT_SPACE}min`;
  const h = Math.floor(minutes / 60);
  return h < 24 ? `${h}${UNIT_SPACE}h` : `${Math.floor(h / 24)}${UNIT_SPACE}d`;
}

export function attentionCopy(
  item: HomeAttentionItem,
  thresholds: HomePayload['thresholds'],
): AttentionCopy {
  switch (item.kind) {
    case 'waiting_sla':
      return {
        title: `${plural(item.count, 'conversa esperando', 'conversas esperando')} há mais de ${thresholds.slaMinutes}${UNIT_SPACE}min`,
        context:
          thresholds.slaSource === 'workspace_rule'
            ? 'Inbox · acima do SLA de 1ª resposta da empresa'
            : 'Inbox · responda ou atribua agora',
        // O servidor manda a conversa quando é uma só; senão, a fila.
        action: item.count === 1 ? 'Responder' : 'Abrir fila',
        time: item.oldestMinutes === null ? null : shortMinutes(item.oldestMinutes),
      };
    case 'deals_stalled':
      return {
        title: `${plural(item.count, 'negócio parado', 'negócios parados')} há mais de ${thresholds.stalledDays}${UNIT_SPACE}dias`,
        context: 'Pipeline · retome ou feche',
        action: 'Ver negócios',
        time: null,
      };
    case 'channel_down':
      // Só a conexão Meta vencida: o servidor aponta para a tela da Meta.
      if (item.href === '/settings/meta') {
        return {
          title: 'O acesso à Meta expirou',
          context: 'WhatsApp e Instagram · mensagens podem não chegar',
          action: 'Reconectar',
          time: null,
        };
      }
      return {
        title:
          item.count === 1
            ? 'Uma conexão de canal caiu'
            : `${formatInt(item.count)} conexões de canal caíram`,
        context: 'Canais · mensagens podem não chegar',
        action: 'Reconectar',
        time: null,
      };
    case 'media_failed':
      return {
        title: `${plural(item.count, 'mídia que falhou', 'mídias que falharam')} ao baixar`,
        context: `Inbox · últimos ${thresholds.mediaFailedDays}${UNIT_SPACE}dias`,
        action: item.count === 1 ? 'Abrir conversa' : 'Abrir inbox',
        time: null,
      };
  }
}

/** Destino da ação de um alerta de `/dashboard/me`, pela métrica de origem. */
export function alertHref(alert: Pick<DashboardAlert, 'metricKey'>): string {
  switch (alert.metricKey) {
    case 'sla_violado_hoje':
      return '/conversations?status=open';
    case 'cap_mensal_consumido_pct':
      return '/settings/usage';
    default:
      // Alerta novo sem destino próprio: leva ao painel completo, onde o card dele vive.
      return '#home-painel';
  }
}

/** Contexto e verbo da linha de um alerta de `/dashboard/me` (o texto vem do servidor). */
export function alertCopy(alert: Pick<DashboardAlert, 'metricKey'>): {
  readonly context: string;
  readonly action: string;
} {
  switch (alert.metricKey) {
    case 'sla_violado_hoje':
      return { context: 'Inbox · SLA de hoje', action: 'Ver conversas' };
    case 'cap_mensal_consumido_pct':
      return { context: 'Uso · limite mensal de IA', action: 'Ver uso' };
    default:
      return { context: 'Painel completo', action: 'Ver' };
  }
}

// ─── Gráfico ─────────────────────────────────────────────────────────────────

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ChartGeometry {
  readonly points: readonly ChartPoint[];
  readonly line: string;
  readonly area: string;
  readonly max: number;
  readonly total: number;
}

const f = (n: number): string => n.toFixed(2);
const at = (arr: readonly number[], i: number): number => arr[i] ?? 0;

/** Curva monótona (Fritsch-Carlson): suave como a maquete, sem ondular abaixo de zero. */
export function monotonePath(pts: readonly ChartPoint[]): string {
  const n = pts.length;
  const first = pts[0];
  if (!first) return '';
  if (n === 1) return `M${f(first.x)} ${f(first.y)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) return '';
    dx.push(b.x - a.x);
    slope.push(b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x));
  }
  const t: number[] = new Array<number>(n).fill(0);
  t[0] = at(slope, 0);
  t[n - 1] = at(slope, n - 2);
  for (let i = 1; i < n - 1; i += 1) {
    t[i] = at(slope, i - 1) * at(slope, i) <= 0 ? 0 : (at(slope, i - 1) + at(slope, i)) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    const s = at(slope, i);
    if (s === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = at(t, i) / s;
    const b = at(t, i + 1) / s;
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * s;
      t[i + 1] = k * b * s;
    }
  }

  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) break;
    const w = at(dx, i) / 3;
    d += ` C${f(a.x + w)} ${f(a.y + at(t, i) * w)} ${f(b.x - w)} ${f(b.y - at(t, i + 1) * w)} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

/**
 * Pontos do gráfico de receita num viewBox `width × height`, com `pad` livre em cima e
 * embaixo. Série toda zerada vira uma linha reta na base (honesto: não há pico a inventar).
 */
export function buildChartGeometry(
  series: readonly HomeRevenuePoint[],
  width: number,
  height: number,
  pad = 8,
): ChartGeometry {
  const n = series.length;
  const max = series.reduce((m, p) => Math.max(m, p.valueCents), 0);
  const total = series.reduce((s, p) => s + p.valueCents, 0);
  const usable = height - pad * 2;
  const points: ChartPoint[] = series.map((p, i) => ({
    x: n <= 1 ? 0 : (i / (n - 1)) * width,
    y: max === 0 ? height - pad : pad + (1 - p.valueCents / max) * usable,
  }));
  const line = monotonePath(points);
  const last = points[points.length - 1];
  const firstPoint = points[0];
  const area =
    line && last && firstPoint
      ? `${line} L${f(last.x)} ${f(height)} L${f(firstPoint.x)} ${f(height)}Z`
      : '';
  return { points, line, area, max, total };
}
