/**
 * Monta o payload do `GET /dashboard/me` (DASHBOARD.md §8, §9.1) — **server-driven**.
 *
 * Dado o member (role + id) e o workspace, retorna SÓ os cards/alerts que o role
 * pode ver. O frontend renderiza por `cardType` via registry — nunca decide
 * visibilidade por role (anti-padrão v1 §10). A filtragem fina (linhas que o member
 * vê) já vem da RLS + dos parâmetros de escopo das queries.
 *
 * Resolução de valor: **100% via registry declarativo** (`metrics/`). Cada métrica é
 * um módulo auto-contido que sabe resolver o próprio valor conforme sua cadência
 * (query live, snapshot 5min com fallback, ou materialized view). Não há mais `switch`
 * por key aqui — adicionar um card não toca este arquivo.
 *
 * `layoutPreferences` vem de `members.dashboard_layout` (jsonb já existente) e diz
 * ao front quais cards o member escondeu/reordenou (sem nunca devolver card de role
 * não autorizado).
 */
import type { Role } from '@hm/shared';
import { schema, type DbTx } from '@hm/db';
import { eq } from 'drizzle-orm';
import {
  getMetricModule,
  metricsForRole,
  visibleMetricKeys,
} from './metrics/registry';
import type {
  CardType,
  MetricCadence,
  MetricCategory,
  MetricCtx,
  MetricDefinition,
} from './metrics/types';
import { hasConversionType, type MetricValue } from './queries';
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
 * Resolve o valor de uma métrica via seu módulo no registry. `null` = sem dado
 * disponível (ex.: MV ainda não populada em dev, ou métrica estratégica não calculada
 * nesta fase) — o front omite o card vazio em vez de mostrar zero enganoso.
 */
async function resolveValue(
  tx: DbTx,
  m: MetricDefinition,
  args: LoadDashboardArgs,
): Promise<MetricValue | null> {
  const mod = getMetricModule(m.key);
  if (!mod) return null;
  const ctx: MetricCtx = {
    tx,
    workspaceId: args.workspaceId,
    memberId: args.memberId,
    role: args.role,
    scope: m.scope,
  };
  return mod.resolve(ctx);
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
export { visibleMetricKeys };
