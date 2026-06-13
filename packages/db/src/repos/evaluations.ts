/**
 * Repo do dominio de avaliacao de qualidade / CSAT / objecoes (F29).
 *
 * conversation_evaluations e objections sao workspace-scoped (RLS). Os metodos
 * recebem o executor (DB ou DbTx) por parametro: o worker de persistencia
 * (F29-S03) e as leituras agregadas do dashboard (F29-S04) passam o tx de
 * withWorkspace (a transacao aplica app.workspace_id, RLS isola e o WITH CHECK
 * barra cross-tenant). O upsert por conversation_id (UNIQUE) garante idempotencia:
 * rodar 2x nao duplica avaliacao; as objecoes sao reescritas (delete + insert).
 */
import { and, avg, count, desc, eq, sql } from 'drizzle-orm';
import type { DB, DbTx } from '../client';
import {
  conversationEvaluations,
  objections,
  type CsatLabel,
  type HandledBy,
  type ObjectionCategory,
} from '../schema';

export type ConversationEvaluation = typeof conversationEvaluations.$inferSelect;
export type Objection = typeof objections.$inferSelect;

type Executor = DB | DbTx;

export interface ObjectionInput {
  category: ObjectionCategory;
  label: string;
  excerpt: string | null;
  resolved: boolean;
}

export interface EvaluationInput {
  workspaceId: string;
  conversationId: string;
  agentId: string | null;
  primaryMemberId: string | null;
  handledBy: HandledBy;
  qualityScore: number;
  qualityRationale: string | null;
  sentimentScore: number | null;
  csatLabel: CsatLabel | null;
  judgeModel: string;
  judgeCostUsd: string;
  raw: Record<string, unknown>;
  objections: ObjectionInput[];
}

export interface QualityAverage {
  avgQuality: number | null;
  sample: number;
}

export interface SatisfactionSummary {
  avgSentiment: number | null;
  promoters: number;
  neutrals: number;
  detractors: number;
  sample: number;
}

export interface QualityByActor {
  actorId: string | null;
  avgQuality: number | null;
  sample: number;
}

export interface ObjectionRankRow {
  category: ObjectionCategory;
  total: number;
  resolved: number;
}

export interface ObjectionExample {
  label: string;
  excerpt: string | null;
  resolved: boolean;
  occurredAt: Date;
}

function toNum(v: string | null): number | null {
  return v === null ? null : Number(v);
}

export const evaluationsRepo = {
  async upsert(db: Executor, input: EvaluationInput): Promise<ConversationEvaluation> {
    const [evaluation] = await db
      .insert(conversationEvaluations)
      .values({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        primaryMemberId: input.primaryMemberId,
        handledBy: input.handledBy,
        qualityScore: input.qualityScore,
        qualityRationale: input.qualityRationale,
        sentimentScore: input.sentimentScore,
        csatLabel: input.csatLabel,
        judgeModel: input.judgeModel,
        judgeCostUsd: input.judgeCostUsd,
        raw: input.raw,
        evaluatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: conversationEvaluations.conversationId,
        set: {
          agentId: input.agentId,
          primaryMemberId: input.primaryMemberId,
          handledBy: input.handledBy,
          qualityScore: input.qualityScore,
          qualityRationale: input.qualityRationale,
          sentimentScore: input.sentimentScore,
          csatLabel: input.csatLabel,
          judgeModel: input.judgeModel,
          judgeCostUsd: input.judgeCostUsd,
          raw: input.raw,
          evaluatedAt: new Date(),
        },
      })
      .returning();
    if (!evaluation) throw new Error('Falha ao gravar conversation_evaluation.');

    await db.delete(objections).where(eq(objections.evaluationId, evaluation.id));
    if (input.objections.length > 0) {
      await db.insert(objections).values(
        input.objections.map((o) => ({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          evaluationId: evaluation.id,
          category: o.category,
          label: o.label,
          excerpt: o.excerpt,
          resolved: o.resolved,
        })),
      );
    }
    return evaluation;
  },

  async findByConversation(
    db: Executor,
    conversationId: string,
  ): Promise<ConversationEvaluation | null> {
    const [row] = await db
      .select()
      .from(conversationEvaluations)
      .where(eq(conversationEvaluations.conversationId, conversationId))
      .limit(1);
    return row ?? null;
  },

  async qualityAverage(db: Executor, since: Date): Promise<QualityAverage> {
    const [row] = await db
      .select({ avgQuality: avg(conversationEvaluations.qualityScore), sample: count() })
      .from(conversationEvaluations)
      .where(sql`${conversationEvaluations.evaluatedAt} >= ${since}`);
    return { avgQuality: toNum(row?.avgQuality ?? null), sample: row?.sample ?? 0 };
  },

  async satisfactionSummary(db: Executor, since: Date): Promise<SatisfactionSummary> {
    const [row] = await db
      .select({
        avgSentiment: avg(conversationEvaluations.sentimentScore),
        promoters: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} = 'promoter')::int`,
        neutrals: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} = 'neutral')::int`,
        detractors: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} = 'detractor')::int`,
        sample: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} is not null)::int`,
      })
      .from(conversationEvaluations)
      .where(sql`${conversationEvaluations.evaluatedAt} >= ${since}`);
    return {
      avgSentiment: toNum(row?.avgSentiment ?? null),
      promoters: row?.promoters ?? 0,
      neutrals: row?.neutrals ?? 0,
      detractors: row?.detractors ?? 0,
      sample: row?.sample ?? 0,
    };
  },

  async qualityByAgent(db: Executor, since: Date): Promise<QualityByActor[]> {
    const rows = await db
      .select({
        actorId: conversationEvaluations.agentId,
        avgQuality: avg(conversationEvaluations.qualityScore),
        sample: count(),
      })
      .from(conversationEvaluations)
      .where(
        and(
          sql`${conversationEvaluations.evaluatedAt} >= ${since}`,
          sql`${conversationEvaluations.agentId} is not null`,
        ),
      )
      .groupBy(conversationEvaluations.agentId)
      .orderBy(desc(avg(conversationEvaluations.qualityScore)));
    return rows.map((r) => ({
      actorId: r.actorId,
      avgQuality: toNum(r.avgQuality),
      sample: r.sample,
    }));
  },

  async qualityByMember(db: Executor, since: Date): Promise<QualityByActor[]> {
    const rows = await db
      .select({
        actorId: conversationEvaluations.primaryMemberId,
        avgQuality: avg(conversationEvaluations.qualityScore),
        sample: count(),
      })
      .from(conversationEvaluations)
      .where(
        and(
          sql`${conversationEvaluations.evaluatedAt} >= ${since}`,
          sql`${conversationEvaluations.primaryMemberId} is not null`,
        ),
      )
      .groupBy(conversationEvaluations.primaryMemberId)
      .orderBy(desc(avg(conversationEvaluations.qualityScore)));
    return rows.map((r) => ({
      actorId: r.actorId,
      avgQuality: toNum(r.avgQuality),
      sample: r.sample,
    }));
  },

  async objectionsRanked(db: Executor, since: Date): Promise<ObjectionRankRow[]> {
    const rows = await db
      .select({
        category: objections.category,
        total: count(),
        resolved: sql<number>`count(*) filter (where ${objections.resolved})::int`,
      })
      .from(objections)
      .where(sql`${objections.occurredAt} >= ${since}`)
      .groupBy(objections.category)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      category: r.category as ObjectionCategory,
      total: r.total,
      resolved: r.resolved,
    }));
  },

  async objectionExamples(
    db: Executor,
    category: ObjectionCategory,
    since: Date,
    limit = 10,
  ): Promise<ObjectionExample[]> {
    const rows = await db
      .select({
        label: objections.label,
        excerpt: objections.excerpt,
        resolved: objections.resolved,
        occurredAt: objections.occurredAt,
      })
      .from(objections)
      .where(and(eq(objections.category, category), sql`${objections.occurredAt} >= ${since}`))
      .orderBy(desc(objections.occurredAt))
      .limit(limit);
    return rows;
  },
};
