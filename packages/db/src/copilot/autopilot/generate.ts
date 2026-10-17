/**
 * Gerador determinístico de sugestões do piloto automático (F73-S13; COPILOTO.md §7.2).
 *
 * `generateSuggestions(tx, workspaceId, now)` roda no worker, de hora em hora, sob o `tx` RLS do
 * workspace. Puro SQL + regras, sem LLM: o mesmo banco no mesmo instante dá a mesma fila.
 *
 * Duas passadas, nesta ordem:
 *
 *   A. REVALIDA as pendentes. Uma pendente só continua se o negócio ainda se qualifica pela regra
 *      de hoje:
 *        `superseded`  o negócio saiu do estágio, foi fechado, ou a regra foi desligada/removida
 *                      ou mudou de destino (a sugestão antiga não vale mais);
 *        `expired`     o cliente voltou a conversar (menos dias parado que o critério) ou a última
 *                      mensagem deixou de ser nossa quando a regra exige.
 *   B. CRIA. Para cada regra ligada (`suggest` | `daily_approval`) com critério válido (destino no
 *      mesmo funil e diferente da origem): negócios ABERTOS no estágio com `dealIdleDaysSql` >=
 *      `idle_days` e, se `require_last_outbound`, última mensagem nossa. Pendente que já existe
 *      não duplica (`insertSuggestionIfAbsent`, índice único parcial).
 *
 * Decisões que o texto da spec não fecha:
 *   - RECUSA/APROVAÇÃO RECENTE SUPRIME: negócio com sugestão `rejected` ou `approved` do mesmo
 *     estágio decidida nos últimos `DECIDED_COOLDOWN_DAYS` (14) não volta à fila. Sem isto, recusar
 *     "mover para Reativação" faria a mesma sugestão reaparecer na próxima hora, e desfazer uma
 *     aprovação (7 dias) a recriaria na hora.
 *   - TETO DE SEGURANÇA: no máximo `PENDING_CAP_PER_RULE` (200) pendentes por regra e
 *     `CREATE_PER_RULE_PER_TICK` (200) novas por passada, as mais paradas primeiro (depois as de
 *     maior valor). Estágio com milhares de negócios parados não inunda a fila. O `daily_limit`
 *     da regra NÃO é aplicado aqui: é do "mover sozinho" (F73-S16, v1.1).
 *
 * `set local jit = off`: o predicado de escopo/uma subconsulta correlacionada por negócio dispara
 * o JIT do Postgres (18 ms viram 800 ms); estas leituras são de índice, JIT só atrapalha.
 * O `now` é sempre explícito (testes com relógio fixo; o relógio do container difere do host).
 */
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { DbTx } from '../../client';
import { copilotAutopilotRepo } from '../../repos/copilot/autopilot';
import { dealIdleDaysSql, dealLastMessageDirectionSql } from '../../repos/copilot/idle';
import { qualified } from '../../repos/copilot/sql';
import {
  copilotSuggestions,
  type CopilotAutopilotRuleRow,
  type CopilotSuggestionRow,
} from '../../schema/copilot';
import { deals } from '../../schema/pipeline';
import { computeConfidence, loadStageDwell, type StageDwell } from './confidence';
import { buildReason, composeReasonText, confidenceSentence } from './reason';

export const PENDING_CAP_PER_RULE = 200;
export const CREATE_PER_RULE_PER_TICK = 200;
export const DECIDED_COOLDOWN_DAYS = 14;
const UPDATE_CHUNK = 500;

export interface GenerateSuggestionsResult {
  /** Regras ligadas com critério válido. */
  readonly rules: number;
  /** Regras ligadas ignoradas por critério inválido (destino fora do funil, igual à origem...). */
  readonly invalidRules: number;
  readonly created: number;
  /** Pendentes que saíram da fila porque o cliente voltou a conversar. */
  readonly expired: number;
  /** Pendentes que saíram da fila porque a situação mudou (estágio, fechado, regra). */
  readonly superseded: number;
  /** Pendentes do workspace no fim da passada (a contagem do `copilot:suggestions_changed`). */
  readonly pendingCount: number;
}

interface ValidRule {
  readonly stageId: string;
  readonly targetStageId: string;
  readonly idleDays: number;
  readonly requireLastOutbound: boolean;
}

interface StageInfo {
  readonly pipelineId: string;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function nowSql(now: Date): SQL {
  return sql`${now.toISOString()}::timestamptz`;
}

/** Critério da regra ligada, ou `null` se inválido para gerar. */
function toValidRule(
  rule: CopilotAutopilotRuleRow,
  stages: ReadonlyMap<string, StageInfo>,
): ValidRule | null {
  const c = rule.criteria;
  const idleDays = c.idle_days;
  const target = c.target_stage_id;
  if (typeof idleDays !== 'number' || !Number.isInteger(idleDays) || idleDays < 1) return null;
  if (!isUuid(target) || target === rule.stageId) return null;
  const from = stages.get(rule.stageId);
  const to = stages.get(target);
  if (!from || !to || from.pipelineId !== to.pipelineId) return null;
  return {
    stageId: rule.stageId,
    targetStageId: target,
    idleDays,
    requireLastOutbound: c.require_last_outbound === true,
  };
}

async function loadStages(tx: DbTx, workspaceId: string): Promise<Map<string, StageInfo>> {
  const rows = await tx.execute<{ id: string; pipeline_id: string }>(
    sql`select id, pipeline_id from stages where workspace_id = ${workspaceId}::uuid`,
  );
  return new Map(Array.from(rows, (r) => [r.id, { pipelineId: r.pipeline_id }] as const));
}

async function loadFormat(
  tx: DbTx,
  workspaceId: string,
): Promise<{ locale: string; timeZone: string }> {
  const rows = await tx.execute<{ locale: string | null; timezone: string | null }>(
    sql`select locale, timezone from workspaces where id = ${workspaceId}::uuid`,
  );
  const row = Array.from(rows)[0];
  return { locale: row?.locale ?? 'pt-BR', timeZone: row?.timezone ?? 'America/Sao_Paulo' };
}

async function countPending(tx: DbTx, workspaceId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from copilot_suggestions
         where workspace_id = ${workspaceId}::uuid and status = 'pending'`,
  );
  return Number(Array.from(rows)[0]?.n ?? 0);
}

/** `update ... set status where id in (...) and status = 'pending'`, em blocos. */
async function closePending(
  tx: DbTx,
  workspaceId: string,
  ids: readonly string[],
  status: 'expired' | 'superseded',
): Promise<number> {
  let changed = 0;
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const rows = await tx
      .update(copilotSuggestions)
      .set({ status })
      .where(
        and(
          eq(copilotSuggestions.workspaceId, workspaceId),
          inArray(copilotSuggestions.id, chunk),
          eq(copilotSuggestions.status, 'pending'),
        ),
      )
      .returning({ id: copilotSuggestions.id });
    changed += rows.length;
  }
  return changed;
}

/** Passada A: tira da fila o que não vale mais. */
async function revalidatePending(
  tx: DbTx,
  workspaceId: string,
  now: Date,
  rules: ReadonlyMap<string, ValidRule>,
): Promise<{ expired: number; superseded: number }> {
  const s = copilotSuggestions;
  const rows = await tx
    .select({
      id: s.id,
      fromStageId: s.fromStageId,
      toStageId: s.toStageId,
      dealStageId: deals.stageId,
      closedAt: deals.closedAt,
      idle: dealIdleDaysSql(undefined, nowSql(now)),
      direction: dealLastMessageDirectionSql(),
    })
    .from(s)
    .innerJoin(deals, eq(deals.id, s.dealId))
    .where(and(eq(s.workspaceId, workspaceId), eq(s.status, 'pending')));

  const superseded: string[] = [];
  const expired: string[] = [];
  for (const row of rows) {
    const rule = rules.get(row.fromStageId);
    if (
      row.closedAt !== null ||
      row.dealStageId !== row.fromStageId ||
      !rule ||
      rule.targetStageId !== row.toStageId
    ) {
      superseded.push(row.id);
    } else if (
      row.idle < rule.idleDays ||
      (rule.requireLastOutbound && row.direction !== 'outbound')
    ) {
      expired.push(row.id);
    }
  }
  return {
    superseded: await closePending(tx, workspaceId, superseded, 'superseded'),
    expired: await closePending(tx, workspaceId, expired, 'expired'),
  };
}

/** Instante da última mensagem da conversa do negócio (qualquer direção), ou NULL. */
function dealLastMessageAtSql(): SQL<Date | null> {
  return sql<Date | null>`(
    select coalesce(lm.provider_timestamp, lm.created_at)
      from messages lm
     where lm.conversation_id = ${qualified(deals.conversationId)}
     order by coalesce(lm.provider_timestamp, lm.created_at) desc, lm.id desc
     limit 1
  )`;
}

interface Candidate {
  readonly dealId: string;
  readonly idle: number;
  readonly direction: 'inbound' | 'outbound' | null;
  readonly lastMessageAt: Date | null;
}

async function findCandidates(
  tx: DbTx,
  workspaceId: string,
  now: Date,
  rule: ValidRule,
  limit: number,
): Promise<Candidate[]> {
  const idle = dealIdleDaysSql(undefined, nowSql(now));
  const direction = dealLastMessageDirectionSql();
  const cooldownSince = new Date(now.getTime() - DECIDED_COOLDOWN_DAYS * 86_400_000);
  const rows = await tx
    .select({
      dealId: deals.id,
      idle,
      direction,
      lastMessageAt: dealLastMessageAtSql().mapWith((v) =>
        v === null || v === undefined ? null : new Date(v as string | Date),
      ),
    })
    .from(deals)
    .where(
      and(
        eq(deals.workspaceId, workspaceId),
        eq(deals.stageId, rule.stageId),
        isNull(deals.closedAt),
        sql`${idle} >= ${rule.idleDays}`,
        rule.requireLastOutbound ? sql`${direction} = 'outbound'` : undefined,
        sql`not exists (
          select 1 from copilot_suggestions cs
           where cs.deal_id = ${qualified(deals.id)}
             and (
               cs.status = 'pending'
               or (
                 cs.from_stage_id = ${rule.stageId}::uuid
                 and cs.status in ('rejected', 'approved')
                 and cs.decided_at >= ${cooldownSince.toISOString()}::timestamptz
               )
             )
        )`,
      ),
    )
    .orderBy(sql`${idle} desc`, sql`${qualified(deals.valueCents)} desc`, deals.id)
    .limit(limit);
  return rows;
}

/**
 * Gera, revalida e expira as sugestões do workspace. Idempotente: repetir no mesmo instante não
 * cria nem expira nada de novo.
 */
export async function generateSuggestions(
  tx: DbTx,
  workspaceId: string,
  now: Date,
): Promise<GenerateSuggestionsResult> {
  await tx.execute(sql`set local jit = off`);

  const allRules = await copilotAutopilotRepo.listRules(tx);
  const stages = await loadStages(tx, workspaceId);

  const valid = new Map<string, ValidRule>();
  let invalidRules = 0;
  for (const rule of allRules) {
    if (rule.mode !== 'suggest' && rule.mode !== 'daily_approval') continue;
    const v = toValidRule(rule, stages);
    if (v) valid.set(v.stageId, v);
    else invalidRules += 1;
  }

  const closed = await revalidatePending(tx, workspaceId, now, valid);

  let created = 0;
  if (valid.size > 0) {
    const fmt = await loadFormat(tx, workspaceId);
    const dwell: Map<string, StageDwell> = await loadStageDwell(
      tx,
      workspaceId,
      [...valid.keys()],
      now,
    );
    for (const rule of valid.values()) {
      const pending = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from copilot_suggestions
             where workspace_id = ${workspaceId}::uuid and status = 'pending'
               and from_stage_id = ${rule.stageId}::uuid`,
      );
      const room = PENDING_CAP_PER_RULE - Number(Array.from(pending)[0]?.n ?? 0);
      if (room <= 0) continue;
      const candidates = await findCandidates(
        tx,
        workspaceId,
        now,
        rule,
        Math.min(room, CREATE_PER_RULE_PER_TICK),
      );
      for (const c of candidates) {
        const confidence = computeConfidence(c.idle, dwell.get(rule.stageId));
        const reason = buildReason({
          idleDays: c.idle,
          lastDirection: c.direction,
          lastMessageAt: c.lastMessageAt,
          locale: fmt.locale,
          timeZone: fmt.timeZone,
        });
        const row: CopilotSuggestionRow | null =
          await copilotAutopilotRepo.insertSuggestionIfAbsent(tx, {
            workspaceId,
            dealId: c.dealId,
            fromStageId: rule.stageId,
            toStageId: rule.targetStageId,
            reasonCode: reason.code,
            reasonText: composeReasonText(
              reason,
              confidenceSentence(fmt.locale, confidence.level, confidence.basis),
            ),
            confidence: confidence.level,
          });
        if (row) created += 1;
      }
    }
  }

  return {
    rules: valid.size,
    invalidRules,
    created,
    expired: closed.expired,
    superseded: closed.superseded,
    pendingCount: await countPending(tx, workspaceId),
  };
}
