/**
 * Confiança da sugestão do piloto automático (F73-S13; COPILOTO.md §7.2).
 *
 * Compara os dias parado do negócio com o tempo que os negócios GANHOS nos últimos 180 dias
 * ficaram naquele estágio (mediana p50 e p90):
 *
 *   dias parado >  p90            → high    (passou do tempo em que quase todo ganho saiu do estágio)
 *   p50 <= dias parado <= p90     → medium
 *   dias parado <  p50            → low
 *   menos de 10 negócios ganhos   → medium fixo, base `thin_history` ("pouco histórico")
 *
 * O tempo no estágio vem de `deal_history` (`stage_changed`): cada mudança de estágio fecha uma
 * permanência (estágio de origem), que começa na mudança anterior do mesmo negócio ou, na
 * primeira, na criação do negócio. O percentil é contínuo (`percentile_cont`), em dias.
 */
import { sql } from 'drizzle-orm';
import type { DbTx } from '../../client';

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ConfidenceBasis = 'history' | 'thin_history';

/** Janela do histórico de negócios ganhos. */
export const CONFIDENCE_WINDOW_DAYS = 180;
/** Menos negócios ganhos que isto = histórico fino (medium fixo). */
export const CONFIDENCE_MIN_WINS = 10;

/** Permanência dos negócios ganhos em um estágio. */
export interface StageDwell {
  /** Negócios ganhos distintos que passaram pelo estágio na janela. */
  readonly wins: number;
  readonly p50Days: number;
  readonly p90Days: number;
}

export interface Confidence {
  readonly level: ConfidenceLevel;
  readonly basis: ConfidenceBasis;
}

/** Pura: a regra acima. `dwell` ausente conta como histórico fino. */
export function computeConfidence(
  idleDays: number,
  dwell: StageDwell | null | undefined,
): Confidence {
  if (!dwell || dwell.wins < CONFIDENCE_MIN_WINS) {
    return { level: 'medium', basis: 'thin_history' };
  }
  if (idleDays > dwell.p90Days) return { level: 'high', basis: 'history' };
  if (idleDays >= dwell.p50Days) return { level: 'medium', basis: 'history' };
  return { level: 'low', basis: 'history' };
}

/**
 * p50 e p90 da permanência dos negócios ganhos nos estágios `stageIds`, nos 180 dias antes de
 * `now`. Estágio sem nenhuma permanência medida fica fora do mapa. Roda sob o `tx` RLS do
 * workspace e filtra `workspace_id` no SQL.
 */
export async function loadStageDwell(
  tx: DbTx,
  workspaceId: string,
  stageIds: readonly string[],
  now: Date,
): Promise<Map<string, StageDwell>> {
  const out = new Map<string, StageDwell>();
  if (stageIds.length === 0) return out;
  const since = new Date(now.getTime() - CONFIDENCE_WINDOW_DAYS * 86_400_000);
  const ids = sql.join(
    stageIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute<{
    stage_id: string;
    wins: number;
    p50: string | number;
    p90: string | number;
  }>(sql`
    with dwell as (
      select (h.from_value ->> 'stageId')::uuid as stage_id,
             h.deal_id,
             h.created_at as left_at,
             coalesce(
               lag(h.created_at) over (partition by h.deal_id order by h.created_at, h.id),
               d.created_at
             ) as entered_at
        from deal_history h
        join deals d on d.id = h.deal_id and d.workspace_id = h.workspace_id
       where h.workspace_id = ${workspaceId}::uuid
         and h.event_type = 'stage_changed'
         and d.closed_at is not null
         and d.closed_won = true
         and d.closed_at >= ${since.toISOString()}::timestamptz
         and d.closed_at <= ${now.toISOString()}::timestamptz
    )
    select stage_id,
           count(distinct deal_id)::int as wins,
           percentile_cont(0.5) within group (
             order by extract(epoch from (left_at - entered_at)) / 86400.0
           ) as p50,
           percentile_cont(0.9) within group (
             order by extract(epoch from (left_at - entered_at)) / 86400.0
           ) as p90
      from dwell
     where stage_id in (${ids})
       and left_at >= entered_at
     group by stage_id
  `);
  for (const r of rows) {
    const p50 = Number(r.p50);
    const p90 = Number(r.p90);
    if (!Number.isFinite(p50) || !Number.isFinite(p90)) continue;
    out.set(r.stage_id, { wins: Number(r.wins), p50Days: p50, p90Days: p90 });
  }
  return out;
}
