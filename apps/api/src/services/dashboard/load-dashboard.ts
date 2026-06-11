/**
 * Monta o payload do `GET /dashboard/me` (DASHBOARD.md §8, §9.1) — **server-driven**.
 *
 * Dado o member (role + id) e o workspace, retorna SÓ os cards/alerts que o role
 * pode ver. O frontend (S03) renderiza por `cardType` via registry — nunca decide
 * visibilidade por role (anti-padrão v1 §10). A filtragem fina (linhas que o member
 * vê) já vem da RLS + dos parâmetros de escopo das queries.
 *
 * Resolução de valor por cadência:
 *  - socket / live: query direta (estado operacional sempre fresco no load).
 *  - snapshot_5min: lê `dashboard_snapshots`; se ainda não populado, faz fallback
 *     para a query live (primeira pintura completa mesmo antes do 1º tick do job).
 *  - mv_1h / mv_1d: lê a materialized view correspondente.
 *
 * `layoutPreferences` vem de `members.dashboard_layout` (jsonb já existente) e diz
 * ao front quais cards o member escondeu/reordenou (S04 escreve; aqui só repassa,
 * sem nunca devolver card de role não autorizado).
 */
import type { Role } from '@hm/shared';
import { schema, type DbTx } from '@hm/db';
import { eq } from 'drizzle-orm';
import {
  METRIC_DEFINITIONS,
  metricsForRole,
  type CardType,
  type MetricCadence,
  type MetricCategory,
  type MetricDefinition,
} from './definitions';
import {
  aguardandoAtribuicao,
  conversoesMinhasMes,
  conversoesWorkspaceMes,
  contatosTotalWorkspace,
  custoLlmHojeUsd,
  emAtendimentoIa,
  hasConversionType,
  inboxPorDepartamento,
  minhaFilaPendente,
  minhasConversasAbertas,
  novosContatosMes,
  readConversionsMonth,
  readLlmCostMonth,
  readSnapshot,
  readVolume24h,
  valorTotalPipeline,
  type MetricValue,
} from './queries';
import { buildAlerts, type DashboardAlert } from './alerts';

const { members } = schema;

export interface DashboardCard {
  readonly key: string;
  readonly label: string;
  readonly category: MetricCategory;
  readonly cardType: CardType;
  readonly cadence: MetricCadence;
  readonly value: MetricValue | null;
  readonly drillHref: string | null;
}

export interface DashboardLayoutPreferences {
  readonly hidden: string[];
  readonly order: string[];
  readonly period: string | null;
}

export interface DashboardPayload {
  readonly role: Role;
  readonly cards: DashboardCard[];
  readonly alerts: DashboardAlert[];
  readonly layoutPreferences: DashboardLayoutPreferences;
}

export interface LoadDashboardArgs {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
}

/**
 * Resolve o valor de uma métrica conforme sua fonte. `null` = sem dado disponível
 * (ex.: MV ainda não populada em dev, ou métrica estratégica não calculada nesta
 * fase) — o front omite o card vazio em vez de mostrar zero enganoso.
 */
async function resolveValue(
  tx: DbTx,
  m: MetricDefinition,
  args: LoadDashboardArgs,
): Promise<MetricValue | null> {
  const { workspaceId, memberId } = args;
  switch (m.key) {
    // Atendimento (live)
    case 'minhas_conversas_abertas':
      return minhasConversasAbertas(tx, memberId);
    case 'minha_fila_pendente':
      return minhaFilaPendente(tx, memberId);
    case 'aguardando_atribuicao':
      return aguardandoAtribuicao(tx);
    case 'em_atendimento_ia':
      return emAtendimentoIa(tx);
    case 'inbox_por_departamento':
      return inboxPorDepartamento(tx);
    // SLA / resolvidas: dependem do job 5min (snapshot). Sem fallback live barato → snapshot.
    case 'sla_violado_hoje':
      return readSnapshot(tx, m.key, {});
    case 'resolvidas_hoje_por_mim':
      return readSnapshot(tx, m.key, { memberId });
    // Volumes 24h: MVs.
    case 'volume_inbound_24h':
    case 'volume_outbound_24h':
      return readVolume24h(tx, workspaceId);
    // Pipeline
    case 'valor_total_pipeline':
      return valorTotalPipeline(tx);
    case 'deals_fechados_ganho_mes':
      return readSnapshot(tx, m.key, {});
    // Agentes IA
    case 'custo_llm_hoje_usd':
      return custoLlmHojeUsd(tx, workspaceId);
    case 'custo_llm_mes_usd':
      return readLlmCostMonth(tx, workspaceId);
    // Conversões
    case 'conversoes_minhas_mes':
      return conversoesMinhasMes(tx, memberId);
    case 'conversoes_workspace_mes':
    case 'valor_convertido_workspace_mes':
      return conversoesWorkspaceMes(tx);
    case 'conversoes_por_tipo':
      return readConversionsMonth(tx, workspaceId);
    // Negócio
    case 'novos_contatos_mes':
      return novosContatosMes(tx);
    case 'contatos_total_workspace':
      return contatosTotalWorkspace(tx);
    default:
      return null;
  }
}

function readLayout(raw: Record<string, unknown>): DashboardLayoutPreferences {
  const hidden = Array.isArray(raw['hidden'])
    ? (raw['hidden'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const order = Array.isArray(raw['order'])
    ? (raw['order'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const period = typeof raw['period'] === 'string' ? raw['period'] : null;
  return { hidden, order, period };
}

export async function loadDashboard(tx: DbTx, args: LoadDashboardArgs): Promise<DashboardPayload> {
  const conversionGate = await hasConversionType(tx);
  const visible = metricsForRole(args.role, conversionGate);

  const cards = await Promise.all(
    visible.map(async (m): Promise<DashboardCard> => {
      const value = await resolveValue(tx, m, args);
      return {
        key: m.key,
        label: m.label,
        category: m.category,
        cardType: m.cardType,
        cadence: m.cadence,
        value,
        drillHref: m.drillHref ? m.drillHref({ memberId: args.memberId }) : null,
      };
    }),
  );

  const [memberRow] = await tx
    .select({ layout: members.dashboardLayout })
    .from(members)
    .where(eq(members.id, args.memberId))
    .limit(1);
  const layoutPreferences = readLayout((memberRow?.layout ?? {}) as Record<string, unknown>);

  const alerts = await buildAlerts(tx, args, cards);

  return { role: args.role, cards, alerts, layoutPreferences };
}

/** Conjunto de keys que um role pode ver (sem gate de conversão) — usado em testes/§8. */
export function visibleMetricKeys(role: Role): string[] {
  return METRIC_DEFINITIONS.filter((m) => m.roles.includes(role)).map((m) => m.key);
}
