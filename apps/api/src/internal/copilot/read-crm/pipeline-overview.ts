/**
 * `get_pipeline_overview` · o funil por estágio (F73-S06): onde o dinheiro está parado.
 *
 * Por estágio, sob o escopo do membro:
 * - `count` e `value`: negócios EM ABERTO que estão hoje no estágio (os fechados saem do
 *   quadro; a receita ganha está em `forecast_revenue`);
 * - `idle_over_7d`: dos abertos, quantos estão parados há mais de 7 dias (a régua única
 *   `dealIdleDaysSql` de `@hm/db`);
 * - `conversion_to_next`: dos negócios CRIADOS nos últimos 180 dias que passaram pelo estágio
 *   (estão nele hoje ou o histórico `stage_changed` o cita como origem ou destino), a fração
 *   que chegou a algum estágio POSTERIOR do funil. `null` no último estágio e quando nenhum
 *   negócio da janela passou por ele.
 *
 * Funil padrão: o marcado como padrão (ou o mais antigo ativo) quando `pipeline_id` não vem.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { dealIdleDaysSql, schema, type DbTx } from '@hm/db';
import { z } from 'zod';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { dealScope, resolveVisible } from '../../../services/copilot/identity/scope';
import { defineCopilotTool } from '../core/registry';
import { centsToUnits, clip, loadWorkspaceFormat, notFound } from './common';
import { fitModelView, READ_MAX_ROWS, startRead } from './limits';

const { deals, stages, pipelines } = schema;

/** Parado há mais de N dias (a coluna `idle_over_7d` do contrato). */
export const IDLE_THRESHOLD_DAYS = 7;
/** Janela da coorte da conversão. */
const CONVERSION_WINDOW_DAYS = 180;

const ArgsSchema = z
  .object({
    pipeline_id: z.string().uuid().optional().describe('Funil. Sem isso, o funil padrão.'),
  })
  .strict();

async function pickPipeline(
  tx: DbTx,
  principal: CopilotPrincipal,
  requested: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (requested) {
    if (!(await resolveVisible(tx, principal, { type: 'pipeline', id: requested }))) return null;
    const [row] = await tx
      .select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines)
      .where(and(eq(pipelines.id, requested), eq(pipelines.workspaceId, principal.workspaceId)))
      .limit(1);
    return row ?? null;
  }
  const [row] = await tx
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, principal.workspaceId), eq(pipelines.isActive, true)))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt), asc(pipelines.id))
    .limit(1);
  return row ?? null;
}

interface ConversionRow extends Record<string, unknown> {
  readonly stage_id: string;
  readonly entered: number | string;
  readonly advanced: number | string;
}

/** Coorte de 180 dias: quantos passaram por cada estágio e quantos seguiram adiante. */
async function loadConversion(
  tx: DbTx,
  principal: CopilotPrincipal,
  pipelineId: string,
): Promise<Map<string, { entered: number; advanced: number }>> {
  const scope = dealScope(principal);
  const rows = await tx.execute<ConversionRow>(sql`
    with v as (
      select deals.id, deals.stage_id
        from deals
       where deals.workspace_id = ${principal.workspaceId}
         and deals.pipeline_id = ${pipelineId}
         and deals.created_at >= now() - make_interval(days => ${CONVERSION_WINDOW_DAYS})
         ${scope ? sql`and ${scope}` : sql``}
    ), reached as (
      select v.id as deal_id, v.stage_id::text as sid from v
      union
      select h.deal_id, x.sid
        from deal_history h
        join v on v.id = h.deal_id
       cross join lateral (values (h.from_value->>'stageId'), (h.to_value->>'stageId')) as x(sid)
       where h.event_type = 'stage_changed' and x.sid is not null
    ), pos as (
      select r.deal_id, s.id as stage_id, s.position
        from reached r join stages s on s.id::text = r.sid and s.pipeline_id = ${pipelineId}
    ), furthest as (
      select deal_id, max(position) as max_position from pos group by deal_id
    )
    select pos.stage_id::text as stage_id,
           count(*)::int as entered,
           (count(*) filter (where furthest.max_position > pos.position))::int as advanced
      from pos join furthest on furthest.deal_id = pos.deal_id
     group by pos.stage_id`);
  return new Map(
    Array.from(rows).map((r) => [
      String(r.stage_id),
      { entered: Number(r.entered), advanced: Number(r.advanced) },
    ]),
  );
}

export const getPipelineOverview = defineCopilotTool({
  key: 'get_pipeline_overview',
  capability: 'query',
  area: 'pipeline',
  description:
    'Visão do funil por estágio: quantos negócios em aberto, quanto valem, quantos estão parados ' +
    'há mais de 7 dias e a taxa de passagem para o próximo estágio. Use para "o que está ' +
    'travando o funil?", "onde está o dinheiro parado?".',
  args: ArgsSchema,
  requires: ['pipeline.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const pipeline = await pickPipeline(tx, principal, args.pipeline_id);
    if (!pipeline) return notFound('Funil');
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);

    const stageRows = await tx
      .select({ id: stages.id, name: stages.name, position: stages.position })
      .from(stages)
      .where(and(eq(stages.pipelineId, pipeline.id), eq(stages.workspaceId, principal.workspaceId)))
      .orderBy(asc(stages.position))
      .limit(READ_MAX_ROWS + 1);

    const scope = dealScope(principal);
    const openRows = await tx
      .select({
        stageId: deals.stageId,
        count: sql<number>`count(*)`.mapWith(Number),
        valueCents: sql<number>`coalesce(sum(${deals.valueCents}), 0)`.mapWith(Number),
        idle: sql<number>`count(*) filter (where ${dealIdleDaysSql()} > ${IDLE_THRESHOLD_DAYS})`.mapWith(
          Number,
        ),
      })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, principal.workspaceId),
          eq(deals.pipelineId, pipeline.id),
          isNull(deals.closedAt),
          ...(scope ? [scope] : []),
        ),
      )
      .groupBy(deals.stageId);
    const openByStage = new Map(openRows.map((r) => [r.stageId, r]));
    const conversion = await loadConversion(tx, principal, pipeline.id);

    const truncated = stageRows.length > READ_MAX_ROWS;
    const shownStages = stageRows.slice(0, READ_MAX_ROWS);
    const lastIndex = shownStages.length - 1;
    const funnel = shownStages.map((s, i) => {
      const open = openByStage.get(s.id);
      const conv = conversion.get(s.id);
      return {
        stage_id: s.id,
        name: clip(s.name, 120, 'Estágio'),
        count: open?.count ?? 0,
        value: centsToUnits(open?.valueCents ?? 0),
        conversion_to_next:
          i === lastIndex || !conv || conv.entered === 0
            ? null
            : Math.round((conv.advanced / conv.entered) * 10_000) / 10_000,
        idle_over_7d: open?.idle ?? 0,
      };
    });
    const totalOpen = funnel.reduce((s, f) => s + f.count, 0);

    const emitted = ctx.emitResult({
      kind: 'funnel',
      source: {
        label: 'Funil de negócios',
        as_of: new Date().toISOString(),
        record_count: totalOpen,
      },
      truncated,
      data: {
        pipeline_id: pipeline.id,
        pipeline_name: clip(pipeline.name, 120, 'Funil'),
        currency: fmt.currency,
        stages: funnel,
      },
    });

    const fitted = fitModelView(funnel, (shown, omitted) => ({
      pipeline: { id: pipeline.id, name: clip(pipeline.name, 60, 'Funil') },
      currency: fmt.currency,
      open_deals: totalOpen,
      conversion_note: `conversion_to_next = fração (0..1) dos negócios criados nos últimos ${CONVERSION_WINDOW_DAYS} dias que chegaram a um estágio posterior`,
      truncated: truncated || omitted > 0,
      stages: shown.map((f) => ({
        id: f.stage_id,
        name: clip(f.name, 60, 'Estágio'),
        count: f.count,
        value: f.value,
        conversion_to_next: f.conversion_to_next,
        idle_over_7d: f.idle_over_7d,
      })),
    }));

    return { ok: true, decision: 'executed', model_view: fitted.view, ...emitted };
  },
});
