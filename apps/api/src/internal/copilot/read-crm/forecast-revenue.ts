/**
 * `forecast_revenue` · previsão de receita do mês (F73-S06). A matemática e a explicação
 * vivem em `forecast.ts` (puro, testado à mão); aqui só o SQL, sob o escopo do membro.
 *
 * Fonte dos números (todos do banco, nada do modelo):
 * - fechado: Σ `value_cents` dos negócios GANHOS com `closed_at` dentro do mês (fuso do
 *   workspace);
 * - abertos: por estágio, contagem, Σ valor e Σ valor² dos negócios em aberto;
 * - taxas: ganhos e perdidos dos últimos 180 dias que passaram por cada estágio (e pelo funil).
 *
 * Meta: o produto ainda não tem meta de receita no modelo de dados; o cartão não inventa uma.
 */
import { and, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { z } from 'zod';
import { dealScope } from '../../../services/copilot/identity/scope';
import { defineCopilotTool } from '../core/registry';
import { centsToUnits, clip, loadWorkspaceFormat, makeFormatters, round2 } from './common';
import {
  computeForecast,
  explainForecast,
  HISTORY_WINDOW_DAYS,
  MIN_DECIDED,
  Z_80,
  type DecidedStat,
  type OpenStageAggregate,
} from './forecast';
import { startRead } from './limits';

const { deals, stages } = schema;

const PERIODS = ['this_month', 'next_month'] as const;
const ArgsSchema = z
  .object({
    period: z
      .enum(PERIODS)
      .default('this_month')
      .describe('this_month = mês corrente; next_month = mês seguinte.'),
  })
  .strict();

interface WindowRow extends Record<string, unknown> {
  readonly start_at: Date | string;
  readonly end_at: Date | string;
}

interface StatRow extends Record<string, unknown> {
  readonly kind: 'stage' | 'pipeline';
  readonly id: string;
  readonly won: number | string;
  readonly lost: number | string;
}

export const forecastRevenue = defineCopilotTool({
  key: 'forecast_revenue',
  capability: 'query',
  area: 'forecast',
  description:
    'Previsão de receita do mês: o que já foi fechado, o previsto (fechado + negócios abertos × ' +
    'chance histórica do estágio), o intervalo de 80% e os maiores componentes. Use para ' +
    '"previsão de receita do mês", "quanto vou fechar".',
  args: ArgsSchema,
  requires: ['pipeline.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    const f = makeFormatters(fmt);
    const scope = dealScope(principal);
    const scopeAnd = scope ? sql`and ${scope}` : sql``;
    const offset = args.period === 'next_month' ? 1 : 0;

    // Mês no fuso do workspace: [início, fim).
    const windowRows = await tx.execute<WindowRow>(sql`
      select (date_trunc('month', now() at time zone ${fmt.timezone}) + make_interval(months => ${offset}))
               at time zone ${fmt.timezone} as start_at,
             (date_trunc('month', now() at time zone ${fmt.timezone}) + make_interval(months => ${offset + 1}))
               at time zone ${fmt.timezone} as end_at`);
    const win = windowRows[0];
    if (!win) throw new Error('forecast: janela do período');
    const startAt = new Date(win.start_at);
    const endAt = new Date(win.end_at);

    const [closedRow] = await tx
      .select({
        cents: sql<number>`coalesce(sum(${deals.valueCents}), 0)`.mapWith(Number),
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, principal.workspaceId),
          isNotNull(deals.closedAt),
          eq(deals.closedWon, true),
          gte(deals.closedAt, startAt),
          lt(deals.closedAt, endAt),
          ...(scope ? [scope] : []),
        ),
      );
    const closed = centsToUnits(closedRow?.cents ?? 0);

    const openRows = await tx
      .select({
        stageId: deals.stageId,
        pipelineId: deals.pipelineId,
        stageName: stages.name,
        count: sql<number>`count(*)`.mapWith(Number),
        cents: sql<number>`coalesce(sum(${deals.valueCents}), 0)`.mapWith(Number),
        squares:
          sql<number>`coalesce(sum(power(${deals.valueCents}::float8 / 100.0, 2)), 0)`.mapWith(
            Number,
          ),
      })
      .from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .where(
        and(
          eq(deals.workspaceId, principal.workspaceId),
          isNull(deals.closedAt),
          ...(scope ? [scope] : []),
        ),
      )
      .groupBy(deals.stageId, deals.pipelineId, stages.name);
    const open: OpenStageAggregate[] = openRows.map((r) => ({
      stageId: r.stageId,
      pipelineId: r.pipelineId,
      stageName: clip(r.stageName, 120, 'Estágio'),
      deals: r.count,
      sumValue: centsToUnits(r.cents),
      sumSquares: r.squares,
    }));

    // Decididos dos últimos 180 dias: por estágio por onde passaram e por funil.
    const statRows = await tx.execute<StatRow>(sql`
      with decided as (
        select deals.id, deals.pipeline_id, deals.stage_id, (deals.closed_won is true) as won
          from deals
         where deals.workspace_id = ${principal.workspaceId}
           and deals.closed_at is not null
           and deals.closed_at >= now() - make_interval(days => ${HISTORY_WINDOW_DAYS})
           ${scopeAnd}
      ), passed as (
        select d.id as deal_id, d.stage_id::text as sid from decided d
        union
        select h.deal_id, x.sid
          from deal_history h
          join decided d on d.id = h.deal_id
         cross join lateral (values (h.from_value->>'stageId'), (h.to_value->>'stageId')) as x(sid)
         where h.event_type = 'stage_changed' and x.sid is not null
      )
      select 'stage' as kind, s.id::text as id,
             (count(*) filter (where d.won))::int as won,
             (count(*) filter (where not d.won))::int as lost
        from passed p
        join decided d on d.id = p.deal_id
        join stages s on s.id::text = p.sid
       group by s.id
      union all
      select 'pipeline', d.pipeline_id::text,
             (count(*) filter (where d.won))::int,
             (count(*) filter (where not d.won))::int
        from decided d
       group by d.pipeline_id`);
    const stageStats = new Map<string, DecidedStat>();
    const pipelineStats = new Map<string, DecidedStat>();
    for (const r of statRows) {
      const stat = { won: Number(r.won), lost: Number(r.lost) };
      (r.kind === 'stage' ? stageStats : pipelineStats).set(String(r.id), stat);
    }

    const forecast = computeForecast({ closed, open, stageStats, pipelineStats });
    const why = explainForecast(forecast, f);
    const openDeals = open.reduce((s, o) => s + o.deals, 0);
    const monthLabel = new Intl.DateTimeFormat(fmt.locale, {
      month: 'long',
      year: 'numeric',
      timeZone: fmt.timezone,
    }).format(startAt);

    const predicted = round2(forecast.predicted);
    const low = round2(forecast.low);
    const high = round2(forecast.high);
    const emitted = ctx.emitResult({
      kind: 'kpis',
      source: {
        label: `Previsão de receita · ${monthLabel}`,
        as_of: new Date().toISOString(),
        record_count: openDeals + (closedRow?.count ?? 0),
      },
      truncated: false,
      data: {
        currency: fmt.currency,
        items: [
          {
            key: 'closed',
            label: args.period === 'this_month' ? 'Fechado até hoje' : 'Fechado no mês',
            value: round2(closed),
            format: 'currency',
            delta: null,
            range: null,
          },
          {
            key: 'predicted',
            label: 'Previsto',
            value: predicted,
            format: 'currency',
            delta: null,
            range: { low, high },
          },
          {
            key: 'open_value',
            label: 'Em aberto no funil',
            value: round2(forecast.openValue),
            format: 'currency',
            delta: null,
            range: null,
          },
          {
            key: 'open_deals',
            label: 'Negócios em aberto',
            value: openDeals,
            format: 'number',
            delta: null,
            range: null,
          },
        ],
        why,
      },
    });

    return {
      ok: true,
      decision: 'executed',
      model_view: {
        period: {
          key: args.period,
          label: monthLabel,
          from: startAt.toISOString(),
          to: endAt.toISOString(),
        },
        currency: fmt.currency,
        closed: round2(closed),
        predicted,
        range_80: { low, high },
        open_value: round2(forecast.openValue),
        open_deals: openDeals,
        why,
        method:
          `previsto = fechado + Σ valor aberto × chance do estágio (ganhos ÷ decididos nos últimos ${HISTORY_WINDOW_DAYS} dias; ` +
          `abaixo de ${MIN_DECIDED} decididos usa a taxa do funil); intervalo = ± ${Z_80} × raiz da soma de valor² × p × (1 − p). ` +
          'Não há data prevista de fechamento: todo o funil aberto entra no previsto.',
      },
      ...emitted,
    };
  },
});
