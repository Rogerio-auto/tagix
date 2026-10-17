/**
 * Uso e custo do Copiloto no mês corrente (F73-S15; COPILOTO.md P7, P8, §5.2 `GET /usage`).
 *
 * Fonte: `llm_usage_logs` com `surface='copilot'` (custo, uma linha por turno concluído; o
 * custo de turno cancelado não é gravado, COMMS S10) e `copilot_turns` / `copilot_action_proposals`
 * (contagens). O mês é o MESMO do orçamento (mês corrente em UTC, `monthStartUtc`): o `spent_usd`
 * daqui é o número que o teto enxerga, e o `state` sai da mesma régua (`copilotBudgetState`).
 *
 * Tudo sob o `tx` RLS do workspace. Nenhum conteúdo de conversa: valores, contagens e nomes.
 *
 * Definições:
 *   daily          todos os dias do mês até hoje (UTC), com zeros; custo = soma das linhas de uso do
 *                  dia, `turns` = turnos INICIADOS no dia
 *   top_members    5 maiores por custo no mês (o turno diz quem usou; `llm_usage_logs` não guarda o
 *                  membro). Quem saiu da empresa some daqui, mas o custo segue em `spent_usd`
 *   turns          turnos iniciados no mês (recusas por orçamento/limite de taxa não viram turno)
 *   actions_by_risk propostas criadas no mês por nível, sem as `blocked` (nunca viraram ação)
 */
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { schema, type CopilotSettingsView, type DbTx } from '@hm/db';
import { CopilotUsageSchema, type CopilotUsage } from '@hm/shared';
import {
  budgetResetsOn,
  computeBudgetState,
  monthStartUtc,
  monthToDateCopilotSpendUsd,
  nextMonthStartUtc,
} from '../identity/budget';

/** Nome exibido quando o membro não tem nome (nunca o e-mail). */
export const USAGE_UNNAMED_MEMBER = 'Membro da equipe';
export const USAGE_TOP_MEMBERS = 5;

const DAY_MS = 86_400_000;

export type UsageSettings = Pick<
  CopilotSettingsView,
  'monthlyBudgetUsd' | 'budgetAlertPct' | 'budgetMode'
>;

/** Arredonda ruído de ponto flutuante de somas de `numeric(12,8)`. */
function usd(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1e6) / 1e6;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM` do mês (UTC) de `at`. */
export function usageMonthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export async function loadCopilotUsage(
  tx: DbTx,
  workspaceId: string,
  settings: UsageSettings,
  at: Date = new Date(),
): Promise<CopilotUsage> {
  const from = monthStartUtc(at);
  const to = nextMonthStartUtc(at);
  const l = schema.llmUsageLogs;
  const t = schema.copilotTurns;
  const m = schema.members;
  const p = schema.copilotActionProposals;

  const spentUsd = await monthToDateCopilotSpendUsd(tx, workspaceId, at);
  const capUsd = Number(settings.monthlyBudgetUsd);

  // Série diária: custo (uso) e turnos (iniciados), cada um na sua tabela, unidos por dia.
  const usageDay = sql<string>`to_char(${l.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const costByDay = await tx
    .select({ day: usageDay, cost: sql<string>`coalesce(sum(${l.costUsd}), 0)` })
    .from(l)
    .where(
      and(
        eq(l.workspaceId, workspaceId),
        eq(l.surface, 'copilot'),
        gte(l.createdAt, from),
        lt(l.createdAt, to),
      ),
    )
    .groupBy(usageDay);
  const turnDay = sql<string>`to_char(${t.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const turnsByDay = await tx
    .select({ day: turnDay, turns: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.workspaceId, workspaceId), gte(t.startedAt, from), lt(t.startedAt, to)))
    .groupBy(turnDay);
  const costMap = new Map(costByDay.map((r) => [r.day, usd(r.cost)]));
  const turnMap = new Map(turnsByDay.map((r) => [r.day, r.turns]));
  const daily: CopilotUsage['daily'] = [];
  const lastDay = Math.min(at.getTime(), to.getTime() - 1);
  for (let ms = from.getTime(); ms <= lastDay; ms += DAY_MS) {
    const date = isoDay(new Date(ms));
    daily.push({ date, cost_usd: costMap.get(date) ?? 0, turns: turnMap.get(date) ?? 0 });
  }

  // Top membros por custo. O turno é a ponte (`copilot_turn_id`, sem FK de propósito).
  const memberCost = sql<string>`sum(${l.costUsd})`;
  const topRows = await tx
    .select({ memberId: t.memberId, name: m.name, cost: memberCost })
    .from(l)
    .innerJoin(t, and(eq(t.id, l.copilotTurnId), eq(t.workspaceId, l.workspaceId)))
    .innerJoin(m, and(eq(m.id, t.memberId), eq(m.workspaceId, t.workspaceId)))
    .where(
      and(
        eq(l.workspaceId, workspaceId),
        eq(l.surface, 'copilot'),
        gte(l.createdAt, from),
        lt(l.createdAt, to),
      ),
    )
    .groupBy(t.memberId, m.name)
    .orderBy(desc(memberCost), asc(t.memberId))
    .limit(USAGE_TOP_MEMBERS);
  const topIds = topRows.map((r) => r.memberId);
  const memberTurns =
    topIds.length === 0
      ? []
      : await tx
          .select({ memberId: t.memberId, turns: sql<number>`count(*)::int` })
          .from(t)
          .where(
            and(
              eq(t.workspaceId, workspaceId),
              inArray(t.memberId, topIds),
              gte(t.startedAt, from),
              lt(t.startedAt, to),
            ),
          )
          .groupBy(t.memberId);
  const turnsOf = new Map(memberTurns.map((r) => [r.memberId, r.turns]));

  const [turnTotal] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.workspaceId, workspaceId), gte(t.startedAt, from), lt(t.startedAt, to)));

  const riskRows = await tx
    .select({ risk: p.riskLevel, n: sql<number>`count(*)::int` })
    .from(p)
    .where(
      and(
        eq(p.workspaceId, workspaceId),
        gte(p.createdAt, from),
        lt(p.createdAt, to),
        ne(p.status, 'blocked'),
      ),
    )
    .groupBy(p.riskLevel)
    .orderBy(asc(p.riskLevel));

  const usage: CopilotUsage = {
    month: usageMonthKey(at),
    resets_on: budgetResetsOn(at),
    spent_usd: spentUsd,
    cap_usd: capUsd,
    pct: capUsd > 0 ? Math.round((spentUsd / capUsd) * 10_000) / 100 : 0,
    budget_mode: settings.budgetMode,
    state: computeBudgetState({
      spentUsd,
      capUsd,
      alertPct: settings.budgetAlertPct,
      mode: settings.budgetMode,
    }),
    daily,
    top_members: topRows.map((r) => ({
      member_id: r.memberId,
      name: ((r.name ?? '').trim() || USAGE_UNNAMED_MEMBER).slice(0, 120),
      cost_usd: usd(r.cost),
      turns: turnsOf.get(r.memberId) ?? 0,
    })),
    turns: turnTotal?.n ?? 0,
    actions_by_risk: riskRows.flatMap((r) => {
      const risk = r.risk;
      return risk === 1 || risk === 2 || risk === 3 || risk === 4
        ? [{ risk_level: risk, count: r.n }]
        : [];
    }),
  };
  return CopilotUsageSchema.parse(usage);
}
