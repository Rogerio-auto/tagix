/**
 * Telemetria de produto do Copiloto, interna da empresa (F73-S15; COPILOTO.md §9).
 *
 * SÓ eventos e contagens: nenhuma pergunta, resposta, nome de contato ou valor de negócio. Os
 * únicos textos que saem são os nomes dos estágios da própria empresa (aceite do piloto por
 * estágio). Serve a `GET /api/copilot/insights` (`copilot.manage`); a versão de plataforma, entre
 * empresas, é a query do runbook (`docs/runbooks/copilot.md`).
 *
 * Janelas: "semanal" = 7 dias; todo o resto = 30 dias, contados até `now`. Taxas em fração 0..1,
 * `null` quando o denominador é zero (sem dado não é 0%).
 *
 * Definições (mesmas do runbook):
 *   members.weekly_active    membros distintos com ao menos um turno iniciado nos últimos 7 dias
 *   members.eligible         membros ativos cujo papel tem acesso ao Copiloto (papel × matriz)
 *   level3                   propostas de nível 3 DO COPILOTO (o piloto automático é medido à
 *                            parte): confirmadas (`confirmed_at`), canceladas e expiradas sem
 *                            confirmação; `confirm_rate` = confirmadas ÷ (confirmadas + canceladas
 *                            + expiradas)
 *   undo                     `undone` ÷ `executed` (propostas com `executed_at`), por origem
 *   pilot.stages             sugestões decididas nos últimos 30 dias por estágio de origem:
 *                            aceitas (`approved` + `auto_applied`) ÷ decididas (+ `rejected`)
 *   briefing                 briefings `ready` dos últimos 30 dias; "visto no dia" = `seen_at` cai
 *                            na própria `for_date` no fuso do workspace
 *   turns.format_fallback    turnos concluídos cuja resposta caiu no formato de contingência
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type DbTx } from '@hm/db';
import { copilotAccessFor, type CapabilityMatrix, type Role } from '@hm/shared';

export const INSIGHTS_WEEK_DAYS = 7;
export const INSIGHTS_PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();

/**
 * Contrato de `GET /api/copilot/insights`. Local: `@hm/shared/copilot` não tem schema de
 * insights (o pacote não é deste slot). Validado na saída, como o `CopilotUsageSchema`.
 */
export const CopilotInsightsSchema = z
  .object({
    generated_at: z.string().datetime(),
    window_days: z.object({ weekly: z.number().int(), period: z.number().int() }).strict(),
    members: z.object({ eligible: count, weekly_active: count, weekly_active_rate: rate }).strict(),
    level3: z
      .object({
        confirmed: count,
        cancelled: count,
        expired: count,
        confirm_rate: rate,
      })
      .strict(),
    undo: z
      .object({
        executed: count,
        undone: count,
        undo_rate: rate,
        autopilot_executed: count,
        autopilot_undone: count,
        autopilot_undo_rate: rate,
      })
      .strict(),
    pilot: z
      .object({
        accepted: count,
        decided: count,
        accept_rate: rate,
        stages: z.array(
          z
            .object({
              stage_id: z.string().uuid(),
              stage_name: z.string().min(1).max(120),
              accepted: count,
              decided: count,
              accept_rate: rate,
            })
            .strict(),
        ),
      })
      .strict(),
    briefing: z.object({ ready: count, seen_same_day: count, seen_rate: rate }).strict(),
    turns: z
      .object({ completed: count, format_fallback: count, format_fallback_rate: rate })
      .strict(),
  })
  .strict();
export type CopilotInsights = z.infer<typeof CopilotInsightsSchema>;

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

const ROLE_SET: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SUPERVISOR',
  'AGENT',
  'READONLY',
]);

export async function loadCopilotInsights(
  tx: DbTx,
  workspaceId: string,
  matrix: CapabilityMatrix,
  now: Date = new Date(),
): Promise<CopilotInsights> {
  const week = new Date(now.getTime() - INSIGHTS_WEEK_DAYS * DAY_MS);
  const period = new Date(now.getTime() - INSIGHTS_PERIOD_DAYS * DAY_MS);
  const m = schema.members;
  const t = schema.copilotTurns;
  const p = schema.copilotActionProposals;
  const s = schema.copilotSuggestions;
  const b = schema.copilotBriefings;
  const l = schema.llmUsageLogs;

  // Membros elegíveis (papel × matriz) e ativos na semana.
  const roles = await tx
    .select({ role: m.role, n: sql<number>`count(*)::int` })
    .from(m)
    .where(and(eq(m.workspaceId, workspaceId), eq(m.status, 'active')))
    .groupBy(m.role);
  const eligible = roles.reduce(
    (sum, r) =>
      ROLE_SET.has(r.role) && copilotAccessFor(r.role as Role, matrix).allowed ? sum + r.n : sum,
    0,
  );
  const [weekly] = await tx
    .select({ n: sql<number>`count(distinct ${t.memberId})::int` })
    .from(t)
    .where(and(eq(t.workspaceId, workspaceId), gte(t.startedAt, week)));
  const weeklyActive = weekly?.n ?? 0;

  // Propostas de nível 3 do Copiloto.
  const [lvl3] = await tx
    .select({
      confirmed: sql<number>`count(*) filter (where ${p.confirmedAt} is not null)::int`,
      cancelled: sql<number>`count(*) filter (where ${p.status} = 'cancelled' and ${p.confirmedAt} is null)::int`,
      expired: sql<number>`count(*) filter (where ${p.status} = 'expired' and ${p.confirmedAt} is null)::int`,
    })
    .from(p)
    .where(
      and(
        eq(p.workspaceId, workspaceId),
        eq(p.riskLevel, 3),
        eq(p.source, 'copilot'),
        gte(p.createdAt, period),
      ),
    );
  const confirmed = lvl3?.confirmed ?? 0;
  const cancelled = lvl3?.cancelled ?? 0;
  const expired = lvl3?.expired ?? 0;

  // Desfazer, por origem.
  const undoRows = await tx
    .select({
      source: p.source,
      executed: sql<number>`count(*) filter (where ${p.executedAt} is not null)::int`,
      undone: sql<number>`count(*) filter (where ${p.executedAt} is not null and (${p.undoneAt} is not null or ${p.status} in ('undone','partially_undone')))::int`,
    })
    .from(p)
    .where(and(eq(p.workspaceId, workspaceId), gte(p.createdAt, period)))
    .groupBy(p.source);
  const bySource = new Map(undoRows.map((r) => [r.source, r]));
  const manual = bySource.get('copilot');
  const auto = bySource.get('autopilot');
  const executed = (manual?.executed ?? 0) + (auto?.executed ?? 0);
  const undone = (manual?.undone ?? 0) + (auto?.undone ?? 0);

  // Aceite do piloto por estágio de origem.
  const stageRows = await tx
    .select({
      stageId: s.fromStageId,
      stageName: schema.stages.name,
      accepted: sql<number>`count(*) filter (where ${s.status} in ('approved','auto_applied'))::int`,
      decided: sql<number>`count(*)::int`,
    })
    .from(s)
    .innerJoin(
      schema.stages,
      and(eq(schema.stages.id, s.fromStageId), eq(schema.stages.workspaceId, s.workspaceId)),
    )
    .where(
      and(
        eq(s.workspaceId, workspaceId),
        inArray(s.status, ['approved', 'rejected', 'auto_applied']),
        gte(s.decidedAt, period),
      ),
    )
    .groupBy(s.fromStageId, schema.stages.name)
    .orderBy(schema.stages.name);
  const pilotAccepted = stageRows.reduce((sum, r) => sum + r.accepted, 0);
  const pilotDecided = stageRows.reduce((sum, r) => sum + r.decided, 0);

  // Briefing visto no dia (fuso do workspace).
  const [wsRow] = await tx
    .select({ timezone: schema.workspaces.timezone })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const timezone = wsRow?.timezone || 'UTC';
  const [brief] = await tx
    .select({
      ready: sql<number>`count(*)::int`,
      seen: sql<number>`count(*) filter (where ${b.seenAt} is not null and (${b.seenAt} at time zone ${timezone})::date = ${b.forDate})::int`,
    })
    .from(b)
    .where(
      and(
        eq(b.workspaceId, workspaceId),
        eq(b.status, 'ready'),
        gte(b.forDate, period.toISOString().slice(0, 10)),
      ),
    );

  // Turnos concluídos e os que caíram no formato de contingência.
  const [done] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(eq(t.workspaceId, workspaceId), eq(t.status, 'completed'), gte(t.startedAt, period)),
    );
  const [fallback] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(l)
    .where(
      and(
        eq(l.workspaceId, workspaceId),
        eq(l.surface, 'copilot'),
        gte(l.createdAt, period),
        sql`${l.metadata} ->> 'format_fallback' = 'true'`,
      ),
    );
  const completed = done?.n ?? 0;
  const formatFallback = fallback?.n ?? 0;

  const insights: CopilotInsights = {
    generated_at: now.toISOString(),
    window_days: { weekly: INSIGHTS_WEEK_DAYS, period: INSIGHTS_PERIOD_DAYS },
    members: {
      eligible,
      weekly_active: weeklyActive,
      weekly_active_rate: ratio(weeklyActive, eligible),
    },
    level3: {
      confirmed,
      cancelled,
      expired,
      confirm_rate: ratio(confirmed, confirmed + cancelled + expired),
    },
    undo: {
      executed,
      undone,
      undo_rate: ratio(undone, executed),
      autopilot_executed: auto?.executed ?? 0,
      autopilot_undone: auto?.undone ?? 0,
      autopilot_undo_rate: ratio(auto?.undone ?? 0, auto?.executed ?? 0),
    },
    pilot: {
      accepted: pilotAccepted,
      decided: pilotDecided,
      accept_rate: ratio(pilotAccepted, pilotDecided),
      stages: stageRows.map((r) => ({
        stage_id: r.stageId,
        stage_name: r.stageName.slice(0, 120) || 'Estágio',
        accepted: r.accepted,
        decided: r.decided,
        accept_rate: ratio(r.accepted, r.decided),
      })),
    },
    briefing: {
      ready: brief?.ready ?? 0,
      seen_same_day: brief?.seen ?? 0,
      seen_rate: ratio(brief?.seen ?? 0, brief?.ready ?? 0),
    },
    turns: {
      completed,
      format_fallback: formatFallback,
      format_fallback_rate: ratio(formatFallback, completed),
    },
  };
  return CopilotInsightsSchema.parse(insights);
}
