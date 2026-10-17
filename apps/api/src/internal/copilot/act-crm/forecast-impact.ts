/**
 * Impacto de uma movimentação na previsão do mês (F73-S08): a MESMA `p(estágio)` do
 * `forecast_revenue` (`stageProbability` de `read-crm/forecast.ts`, por import).
 *
 *   Δ previsão = Σ_{negócios ABERTOS movidos} valor × (p(destino) − p(origem))
 *
 * As taxas vêm dos negócios DECIDIDOS nos últimos `HISTORY_WINDOW_DAYS` dias que passaram pelo
 * estágio (estão nele ou o `stage_changed` o cita), sob o escopo do membro, com a queda para a
 * taxa do funil abaixo de `MIN_DECIDED`. A consulta é a do `forecast_revenue`, restrita aos
 * funis envolvidos (pendência registrada: extrair a consulta para um módulo de `read-crm`, para
 * que as duas leiam do mesmo lugar também no SQL).
 *
 * Negócio fechado não está na previsão do aberto: não entra no Δ.
 */
import { sql } from 'drizzle-orm';
import type { DbTx } from '@hm/db';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { dealScope } from '../../../services/copilot/identity/scope';
import { centsToUnits, round2 } from '../read-crm/common';
import { HISTORY_WINDOW_DAYS, stageProbability, type DecidedStat } from '../read-crm/forecast';

interface StatRow extends Record<string, unknown> {
  readonly kind: 'stage' | 'pipeline';
  readonly id: string;
  readonly won: number | string;
  readonly lost: number | string;
}

export interface DecidedStats {
  readonly stage: ReadonlyMap<string, DecidedStat>;
  readonly pipeline: ReadonlyMap<string, DecidedStat>;
}

/** Decididos por estágio e por funil (os funis pedidos), sob o escopo do membro. */
export async function loadDecidedStats(
  tx: DbTx,
  principal: CopilotPrincipal,
  pipelineIds: readonly string[],
): Promise<DecidedStats> {
  const stage = new Map<string, DecidedStat>();
  const pipeline = new Map<string, DecidedStat>();
  const ids = [...new Set(pipelineIds)];
  if (ids.length === 0) return { stage, pipeline };
  const scope = dealScope(principal);
  const scopeAnd = scope ? sql`and ${scope}` : sql``;
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute<StatRow>(sql`
    with decided as (
      select deals.id, deals.pipeline_id, deals.stage_id, (deals.closed_won is true) as won
        from deals
       where deals.workspace_id = ${principal.workspaceId}
         and deals.pipeline_id in (${idList})
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
  for (const r of rows) {
    const stat = { won: Number(r.won), lost: Number(r.lost) };
    (r.kind === 'stage' ? stage : pipeline).set(String(r.id), stat);
  }
  return { stage, pipeline };
}

export interface MovedDeal {
  readonly fromStageId: string;
  readonly pipelineId: string;
  readonly valueCents: number;
  readonly open: boolean;
}

/** Δ da previsão (unidades da moeda, 2 casas) ao mover `moved` para `toStageId`. */
export function forecastDelta(
  stats: DecidedStats,
  moved: readonly MovedDeal[],
  toStageId: string,
): number {
  let delta = 0;
  for (const d of moved) {
    if (!d.open) continue;
    const pipe = stats.pipeline.get(d.pipelineId);
    const pTo = stageProbability(stats.stage.get(toStageId), pipe).p;
    const pFrom = stageProbability(stats.stage.get(d.fromStageId), pipe).p;
    delta += centsToUnits(d.valueCents) * (pTo - pFrom);
  }
  return round2(delta);
}
