/**
 * Job de avaliacao pos-conversa (F29-S03 / AGENT_QUALITY_OBJECTIONS.md SS4).
 *
 * A cada tick: enumera workspaces (cross-tenant via getDb), e por workspace (sob
 * RLS via withWorkspace) seleciona conversas `status in ('closed','resolved')`
 * SEM linha em conversation_evaluations (LEFT JOIN), nas ultimas N horas, em lote
 * pequeno. Para cada uma chama o LLM-judge (F29-S02 via @hm/agents-client.evaluate)
 * e persiste conversation_evaluations + objections (F29-S01) numa transacao.
 *
 * Idempotencia: a selecao filtra conversas ja avaliadas; o upsert por
 * UNIQUE(conversation_id) garante que rodar 2x nao duplica. Falha do judge (rede
 * ou 422 saida invalida) NAO persiste parcial — apenas loga e tenta no proximo tick.
 *
 * handled_by vem do judge; agent_id e primary_member_id vem da conversa
 * (agent_id / assigned_to) — o judge so opina em quem conduziu, nao inventa ids.
 */
import { eq, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type { JudgeResult } from '@hm/agents-client';
import type { Logger } from '@hm/logger';
import {
  acquireSchedulerLock,
  DEFAULT_EVALUATION_BATCH,
  DEFAULT_EVALUATION_LOOKBACK_HOURS,
  EVALUATION_LOCK_KEY,
  EVALUATION_LOCK_TTL_MS,
  type RedisLike,
} from './scheduler';

/** Porta do LLM-judge (injeta @hm/agents-client.evaluate; testavel com mock). */
export interface JudgePort {
  evaluate(req: { workspace_id: string; conversation_id: string }): Promise<{
    result: JudgeResult;
    judge_model: string;
    judge_cost_usd: number;
  }>;
}

export interface EvaluationDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly judge: JudgePort;
  readonly batchSize?: number;
  readonly lookbackHours?: number;
}

export interface EvaluationTickResult {
  readonly ran: boolean;
  readonly workspaces: number;
  readonly evaluated: number;
  readonly failed: number;
}

interface PendingConversation {
  readonly id: string;
  readonly agent_id: string | null;
  readonly assigned_to: string | null;
}

/** Enumera workspaces (cross-tenant). */
async function enumerateWorkspaces(): Promise<string[]> {
  const rows = await getDb().execute<{ id: string } & Record<string, unknown>>(
    sql`SELECT id FROM workspaces`,
  );
  return Array.from(rows).map((r) => r.id);
}

/** Seleciona conversas encerradas SEM avaliacao (sob RLS), lote pequeno. */
async function selectPending(
  workspaceId: string,
  batchSize: number,
  lookbackHours: number,
): Promise<PendingConversation[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx.execute<PendingConversation & Record<string, unknown>>(sql`
      SELECT c.id, c.agent_id, c.assigned_to
      FROM conversations c
      LEFT JOIN conversation_evaluations e ON e.conversation_id = c.id
      WHERE c.status IN ('closed', 'resolved')
        AND e.id IS NULL
        AND coalesce(c.updated_at, c.created_at) >= now() - (${lookbackHours} * interval '1 hour')
      ORDER BY coalesce(c.updated_at, c.created_at) ASC
      LIMIT ${batchSize}
    `);
    return Array.from(rows).map((r) => ({
      id: r.id,
      agent_id: r.agent_id,
      assigned_to: r.assigned_to,
    }));
  });
}

/**
 * Persiste a avaliacao + objections de uma conversa numa transacao RLS. Upsert por
 * UNIQUE(conversation_id) (idempotente) + reescrita das objecoes atreladas. Escreve
 * direto no schema (@hm/db) para nao acoplar o worker a um repo nao exportado.
 */
async function persist(
  workspaceId: string,
  conv: PendingConversation,
  judge: JudgeResult,
  judgeModel: string,
  judgeCostUsd: number,
): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const [evaluation] = await tx
      .insert(schema.conversationEvaluations)
      .values({
        workspaceId,
        conversationId: conv.id,
        agentId: conv.agent_id,
        primaryMemberId: conv.assigned_to,
        handledBy: judge.handled_by,
        qualityScore: judge.quality_score,
        qualityRationale: judge.quality_rationale ?? null,
        sentimentScore: judge.sentiment_score ?? null,
        csatLabel: judge.csat_label ?? null,
        judgeModel,
        judgeCostUsd: judgeCostUsd.toFixed(6),
        raw: judge as unknown as Record<string, unknown>,
        evaluatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.conversationEvaluations.conversationId,
        set: {
          agentId: conv.agent_id,
          primaryMemberId: conv.assigned_to,
          handledBy: judge.handled_by,
          qualityScore: judge.quality_score,
          qualityRationale: judge.quality_rationale ?? null,
          sentimentScore: judge.sentiment_score ?? null,
          csatLabel: judge.csat_label ?? null,
          judgeModel,
          judgeCostUsd: judgeCostUsd.toFixed(6),
          raw: judge as unknown as Record<string, unknown>,
          evaluatedAt: new Date(),
        },
      })
      .returning();
    if (!evaluation) throw new Error('evaluation: falha ao gravar conversation_evaluation.');

    // Reescreve as objecoes (idempotente em reprocessamento).
    await tx
      .delete(schema.objections)
      .where(eq(schema.objections.evaluationId, evaluation.id));
    if (judge.objections.length > 0) {
      await tx.insert(schema.objections).values(
        judge.objections.map((o) => ({
          workspaceId,
          conversationId: conv.id,
          evaluationId: evaluation.id,
          category: o.category,
          label: o.label,
          excerpt: o.excerpt ?? null,
          resolved: o.resolved,
        })),
      );
    }
  });
}

/** Avalia + persiste um workspace; devolve {evaluated, failed}. */
async function evaluateWorkspace(
  workspaceId: string,
  deps: EvaluationDeps,
  batchSize: number,
  lookbackHours: number,
): Promise<{ evaluated: number; failed: number }> {
  const pending = await selectPending(workspaceId, batchSize, lookbackHours);
  let evaluated = 0;
  let failed = 0;
  for (const conv of pending) {
    try {
      const out = await deps.judge.evaluate({
        workspace_id: workspaceId,
        conversation_id: conv.id,
      });
      await persist(workspaceId, conv, out.result, out.judge_model, out.judge_cost_usd);
      evaluated += 1;
    } catch (err: unknown) {
      // Falha do judge (rede / 422 saida invalida) ou persistencia: nao persiste
      // parcial, reprograma no proximo tick. Loga sem PII (so o id da conversa).
      failed += 1;
      deps.logger.error('evaluation: avaliacao de conversa falhou', {
        workspaceId,
        conversationId: conv.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { evaluated, failed };
}

export async function runEvaluationTick(deps: EvaluationDeps): Promise<EvaluationTickResult> {
  const release = await acquireSchedulerLock(
    deps.redis,
    EVALUATION_LOCK_KEY,
    EVALUATION_LOCK_TTL_MS,
  );
  if (release === null) return { ran: false, workspaces: 0, evaluated: 0, failed: 0 };

  const batchSize = deps.batchSize ?? DEFAULT_EVALUATION_BATCH;
  const lookbackHours = deps.lookbackHours ?? DEFAULT_EVALUATION_LOOKBACK_HOURS;
  try {
    const workspaceIds = await enumerateWorkspaces();
    let evaluated = 0;
    let failed = 0;
    for (const id of workspaceIds) {
      try {
        const r = await evaluateWorkspace(id, deps, batchSize, lookbackHours);
        evaluated += r.evaluated;
        failed += r.failed;
      } catch (err: unknown) {
        deps.logger.error('evaluation: tick do workspace falhou', {
          workspaceId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (evaluated > 0 || failed > 0) {
      deps.logger.info('evaluation: tick', {
        workspaces: workspaceIds.length,
        evaluated,
        failed,
      });
    }
    return { ran: true, workspaces: workspaceIds.length, evaluated, failed };
  } finally {
    await release();
  }
}
