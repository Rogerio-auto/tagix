/**
 * `aggregate_deals` · agrega negócios sob o escopo do membro (F73-S06).
 *
 * group_by: `stage` | `owner` | `source` | `month` | `product`
 * metric:   `count` | `sum_value` | `avg_value` | `avg_idle_days` | `win_rate`
 *
 * Regras (documentadas porque o número vai para a tela como está, P5):
 * - Status padrão: negócios EM ABERTO. Exceção: `win_rate` não tem status padrão (a taxa é
 *   ganhos ÷ (ganhos + perdidos) entre os DECIDIDOS; só entram negócios fechados).
 * - `month`: mês de CRIAÇÃO; para `win_rate` ou `status` won/lost, mês de FECHAMENTO. Meses no
 *   fuso do workspace. Vira `series`; as demais agrupações viram `table`.
 * - `product`: um negócio com vários itens conta em cada produto (`count` é de negócios
 *   distintos); `sum_value` soma os ITENS (qtd × preço), não o valor do negócio, para não
 *   contar o mesmo dinheiro duas vezes; negócio sem itens cai em "Sem produto" com o valor
 *   do negócio. `avg_idle_days` não existe por produto (pesaria por item).
 * - `win_rate` sai como fração 0..1 (`format: 'percent'`).
 * - Grupos: no máximo 50 (os 36 meses mais recentes para `month`). Ordem: maior valor
 *   primeiro; estágio na ordem do funil; mês em ordem cronológica.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { dealIdleDaysSql, schema, type DbTx } from '@hm/db';
import { z } from 'zod';
import { resolveVisible } from '../../../services/copilot/identity/scope';
import { defineCopilotTool } from '../core/registry';
import { centsToUnits, clip, loadWorkspaceFormat, notFound, round2 } from './common';
import { buildDealWhere, dealFilterShape } from './deal-filters';
import { fitModelView, READ_MAX_ROWS, startRead } from './limits';

const { members, stages, pipelines } = schema;

const GROUP_BYS = ['stage', 'owner', 'source', 'month', 'product'] as const;
const METRICS = ['count', 'sum_value', 'avg_value', 'avg_idle_days', 'win_rate'] as const;
type GroupBy = (typeof GROUP_BYS)[number];
type Metric = (typeof METRICS)[number];

const MONTHS_MAX = 36;
/** Estágios lidos antes de ordenar pelo funil (o corte de 50 linhas vem depois). */
const STAGE_GROUPS_MAX = 500;

const ArgsSchema = z
  .object({
    group_by: z
      .enum(GROUP_BYS)
      .describe('Como agrupar: estágio, responsável, origem, mês ou produto.'),
    metric: z
      .enum(METRICS)
      .describe(
        'count = quantidade; sum_value = soma dos valores; avg_value = valor médio; ' +
          'avg_idle_days = média de dias parado; win_rate = taxa de ganho (ganhos ÷ decididos).',
      ),
    ...dealFilterShape,
  })
  .strict();

const GROUP_LABELS: Readonly<Record<GroupBy, string>> = {
  stage: 'Estágio',
  owner: 'Responsável',
  source: 'Origem',
  month: 'Mês',
  product: 'Produto',
};

const METRIC_LABELS: Readonly<Record<Metric, string>> = {
  count: 'Negócios',
  sum_value: 'Valor total',
  avg_value: 'Valor médio',
  avg_idle_days: 'Dias parado (média)',
  win_rate: 'Taxa de ganho',
};

interface GroupConfig {
  readonly key: SQL;
  readonly label: SQL;
  readonly extra: SQL;
  readonly joins: SQL;
  readonly groupBy: SQL;
  readonly orderBy: SQL | null;
  readonly limit: number;
}

function groupConfig(groupBy: GroupBy, byClose: boolean, timezone: string): GroupConfig {
  switch (groupBy) {
    // Estágio e responsável agrupam só por `deals`: os nomes entram depois (`resolveLabels`).
    // Com JOIN de `stages`/`members` o planejador pode repetir o recorte por grupo.
    case 'stage':
      return {
        key: sql`deals.stage_id::text`,
        label: sql`deals.stage_id::text`,
        extra: sql`deals.pipeline_id::text`,
        joins: sql``,
        groupBy: sql`deals.stage_id, deals.pipeline_id`,
        orderBy: null,
        limit: STAGE_GROUPS_MAX,
      };
    case 'owner':
      return {
        key: sql`coalesce(deals.owner_id::text, 'none')`,
        label: sql`coalesce(deals.owner_id::text, 'none')`,
        extra: sql`null::text`,
        joins: sql``,
        groupBy: sql`deals.owner_id`,
        orderBy: null,
        limit: READ_MAX_ROWS,
      };
    case 'source':
      return {
        key: sql`coalesce(deals.source, 'none')`,
        label: sql`coalesce(deals.source, 'Sem origem')`,
        extra: sql`null::text`,
        joins: sql``,
        groupBy: sql`deals.source`,
        orderBy: null,
        limit: READ_MAX_ROWS,
      };
    case 'month': {
      const basis = byClose ? sql`deals.closed_at` : sql`deals.created_at`;
      const month = sql`to_char(date_trunc('month', ${basis} at time zone ${timezone}), 'YYYY-MM')`;
      return {
        key: month,
        label: month,
        extra: sql`null::text`,
        joins: sql``,
        // Posicional: a expressão tem parâmetro (fuso) e o Postgres a vê como outra expressão
        // se for repetida com outro `$n` (chave e rótulo são as colunas 1 e 2).
        groupBy: sql`1, 2`,
        orderBy: sql`1 desc`,
        limit: MONTHS_MAX,
      };
    }
    case 'product':
      return {
        key: sql`coalesce(deal_items.name_snapshot, 'Sem produto')`,
        label: sql`coalesce(deal_items.name_snapshot, 'Sem produto')`,
        extra: sql`null::text`,
        joins: sql`left join deal_items on deal_items.deal_id = deals.id`,
        groupBy: sql`deal_items.name_snapshot`,
        orderBy: null,
        limit: READ_MAX_ROWS,
      };
  }
}

interface AggRow extends Record<string, unknown> {
  readonly key: string;
  readonly label: string;
  readonly extra: string | null;
  readonly n: number | string;
  readonly sum_cents: number | string | null;
  readonly metric_value: number | string | null;
  readonly won: number | string;
  readonly decided: number | string;
  readonly total_deals: number | string;
}

function metricValue(metric: Metric, row: AggRow): number | null {
  const n = Number(row.n);
  const sumCents = Number(row.sum_cents ?? 0);
  const decided = Number(row.decided);
  switch (metric) {
    case 'count':
      return n;
    case 'sum_value':
      return round2(centsToUnits(sumCents));
    case 'avg_value':
      return n > 0 ? round2(centsToUnits(sumCents) / n) : null;
    case 'avg_idle_days':
      return row.metric_value === null ? null : round2(Number(row.metric_value));
    case 'win_rate':
      return decided > 0 ? Math.round((Number(row.won) / decided) * 10_000) / 10_000 : null;
  }
}

interface Labeled {
  readonly row: AggRow;
  readonly label: string;
}

/**
 * Rótulos dos grupos. Estágio: nome do estágio (e do funil quando o recorte tem mais de um),
 * na ordem do funil. Responsável: nome do membro ("Sem responsável" quando não há).
 * Demais agrupações já vêm rotuladas pelo SQL.
 */
async function resolveLabels(
  tx: DbTx,
  workspaceId: string,
  groupBy: GroupBy,
  rows: readonly AggRow[],
): Promise<Labeled[]> {
  if (groupBy === 'owner') {
    const ids = rows.map((r) => String(r.key)).filter((k) => k !== 'none');
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const found = await tx
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(and(eq(members.workspaceId, workspaceId), inArray(members.id, ids)));
      for (const m of found) if (m.name) names.set(m.id, m.name);
    }
    return rows.map((row) => ({
      row,
      label: row.key === 'none' ? 'Sem responsável' : (names.get(String(row.key)) ?? 'Sem nome'),
    }));
  }
  if (groupBy === 'stage') {
    const stageIds = rows.map((r) => String(r.key));
    if (stageIds.length === 0) return [];
    const stageRows = await tx
      .select({
        id: stages.id,
        name: stages.name,
        position: stages.position,
        pipelineId: stages.pipelineId,
        pipelineName: pipelines.name,
      })
      .from(stages)
      .innerJoin(pipelines, eq(pipelines.id, stages.pipelineId))
      .where(and(eq(stages.workspaceId, workspaceId), inArray(stages.id, stageIds)));
    const byId = new Map(stageRows.map((s) => [s.id, s]));
    // Estágios de funis diferentes podem ter o mesmo nome: desambigua pelo funil.
    const multiPipeline = new Set(stageRows.map((s) => s.pipelineId)).size > 1;
    return rows
      .map((row) => {
        const st = byId.get(String(row.key));
        return {
          row,
          label: st ? (multiPipeline ? `${st.name} · ${st.pipelineName}` : st.name) : 'Sem nome',
          order: [st?.pipelineName ?? '', st?.position ?? 0] as const,
        };
      })
      .sort((a, b) => a.order[0].localeCompare(b.order[0]) || a.order[1] - b.order[1])
      .map(({ row, label }) => ({ row, label }));
  }
  return rows.map((row) => ({ row, label: String(row.label) }));
}

export const aggregateDeals = defineCopilotTool({
  key: 'aggregate_deals',
  capability: 'query',
  area: 'pipeline',
  description:
    'Soma, conta ou tira média dos negócios agrupando por estágio, responsável, origem, mês ou ' +
    'produto, com os mesmos filtros de list_deals. Padrão: negócios em aberto (win_rate usa os ' +
    'já decididos). Use para "quanto tenho em cada estágio", "valor por responsável", ' +
    '"taxa de ganho por origem", "evolução por mês".',
  args: ArgsSchema,
  requires: ['pipeline.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    if (args.metric === 'avg_idle_days' && args.group_by === 'product') {
      return {
        ok: false,
        decision: 'invalid_args',
        model_view:
          'avg_idle_days não está disponível agrupando por produto (um negócio com vários itens pesaria várias vezes). Use group_by stage, owner, source ou month.',
      };
    }
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    if (
      args.pipeline_id &&
      !(await resolveVisible(tx, principal, { type: 'pipeline', id: args.pipeline_id }))
    ) {
      return notFound('Funil');
    }

    const isWinRate = args.metric === 'win_rate';
    const byClose = isWinRate || args.status === 'won' || args.status === 'lost';
    const cfg = groupConfig(args.group_by, byClose, fmt.timezone);
    const where = buildDealWhere(principal, args, {
      defaultStatus: isWinRate ? null : 'open',
      timezone: fmt.timezone,
    });
    // Taxa de ganho e mês de fechamento só fazem sentido com negócios decididos.
    const decidedOnly =
      byClose && args.status !== 'won' && args.status !== 'lost'
        ? sql` and deals.closed_at is not null`
        : sql``;

    const sumExpr =
      args.group_by === 'product'
        ? sql`sum(case when deal_items.id is null then deals.value_cents else deal_items.qty * deal_items.unit_price_cents end)`
        : sql`sum(deals.value_cents)`;
    const orderBy = cfg.orderBy ?? sql`metric_value desc nulls last, label asc`;
    const metricSql: SQL = (() => {
      switch (args.metric) {
        case 'count':
          return sql`count(distinct deals.id)::float8`;
        case 'sum_value':
          return sql`coalesce(${sumExpr}, 0)::float8`;
        case 'avg_value':
          return sql`(coalesce(${sumExpr}, 0)::float8 / nullif(count(distinct deals.id), 0))`;
        case 'avg_idle_days':
          return sql`avg(${dealIdleDaysSql()})::float8`;
        case 'win_rate':
          return sql`(count(distinct deals.id) filter (where deals.closed_at is not null and deals.closed_won = true)::float8
            / nullif(count(distinct deals.id) filter (where deals.closed_at is not null), 0))`;
      }
    })();

    const rows = await tx.execute<AggRow>(sql`
      select ${cfg.key} as key,
             ${cfg.label} as label,
             ${cfg.extra} as extra,
             count(distinct deals.id)::int as n,
             coalesce(${sumExpr}, 0)::float8 as sum_cents,
             count(distinct deals.id) filter (where deals.closed_at is not null and deals.closed_won = true)::int as won,
             count(distinct deals.id) filter (where deals.closed_at is not null)::int as decided,
             (sum(count(distinct deals.id)) over ())::int as total_deals,
             ${metricSql} as metric_value
        from deals ${cfg.joins}
       where ${where}${decidedOnly}
       group by ${cfg.groupBy}
       order by ${orderBy}
       limit ${cfg.limit + 1}`);

    let groupsTruncated = rows.length > cfg.limit;
    let shownRows = Array.from(rows).slice(0, cfg.limit);
    if (args.group_by === 'month') shownRows = shownRows.reverse();
    const labeled = await resolveLabels(tx, principal.workspaceId, args.group_by, shownRows);
    if (labeled.length > READ_MAX_ROWS) groupsTruncated = true;

    const groups = labeled.slice(0, READ_MAX_ROWS).map(({ row: r, label }) => ({
      key: String(r.key),
      label: clip(label, args.group_by === 'month' ? 40 : 120, 'Sem nome'),
      value: metricValue(args.metric, r),
      deals: Number(isWinRate ? r.decided : r.n),
    }));

    let recordCount = rows[0] ? Number(rows[0].total_deals) : 0;
    if (args.group_by === 'product') {
      // Negócio com vários itens aparece em vários grupos: a base é de negócios distintos.
      const counted = await tx.execute<{ n: number | string }>(
        sql`select count(*)::int as n from deals where ${where}${decidedOnly}`,
      );
      recordCount = Number(counted[0]?.n ?? 0);
    }

    const valueFormat =
      args.metric === 'count'
        ? ('number' as const)
        : args.metric === 'avg_idle_days'
          ? ('days' as const)
          : args.metric === 'win_rate'
            ? ('percent' as const)
            : ('currency' as const);
    const isMoney = valueFormat === 'currency';
    const source = {
      label: 'Negócios do pipeline',
      as_of: new Date().toISOString(),
      record_count: recordCount,
    };

    const emitted =
      args.group_by === 'month'
        ? ctx.emitResult({
            kind: 'series',
            source,
            truncated: groupsTruncated,
            data: {
              label: `${METRIC_LABELS[args.metric]} por mês`,
              format: valueFormat,
              currency: isMoney ? fmt.currency : null,
              points: groups
                .filter((g): g is typeof g & { value: number } => g.value !== null)
                .map((g) => ({ x: g.label, y: g.value })),
            },
          })
        : ctx.emitResult({
            kind: 'table',
            source,
            truncated: groupsTruncated,
            data: {
              currency: isMoney ? fmt.currency : null,
              columns: [
                { key: 'group', label: GROUP_LABELS[args.group_by], format: 'text' },
                { key: 'value', label: METRIC_LABELS[args.metric], format: valueFormat },
                { key: 'deals', label: 'Negócios', format: 'number' },
              ],
              rows: groups.map((g) => ({ group: g.label, value: g.value, deals: g.deals })),
            },
          });

    const fitted = fitModelView(groups, (shown, omitted) => ({
      group_by: args.group_by,
      metric: args.metric,
      ...(isMoney ? { currency: fmt.currency } : {}),
      ...(args.metric === 'win_rate' ? { value_is: 'fraction_0_to_1' } : {}),
      total_deals: recordCount,
      truncated: groupsTruncated || omitted > 0,
      groups: shown.map((g) => ({
        key: g.key,
        label: g.label,
        value: g.value,
        deals: g.deals,
      })),
    }));

    return { ok: true, decision: 'executed', model_view: fitted.view, ...emitted };
  },
});
