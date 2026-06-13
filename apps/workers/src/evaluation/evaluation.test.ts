/**
 * Testes do worker de avaliacao pos-conversa (F29-S03). Lock skipping (puro) +
 * tick real contra o Postgres local (infra Docker UP) com JudgePort mockada (o
 * judge real OpenRouter NAO e exercido em CI — custa $ + precisa key). Cobre:
 * selecao de conversas encerradas sem avaliacao, persistencia (eval + objections),
 * idempotencia (rodar 2x nao duplica), e falha do judge (nao persiste parcial).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';

beforeAll(() => {
  if (process.env['DATABASE_URL']) return;
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Sem .env -> getDb() lanca com mensagem clara.
  }
});
import { createLogger } from '@hm/logger';
import { runEvaluationTick, type JudgePort } from './evaluation-job';
import type { RedisLike } from './scheduler';

const logger = createLogger('error');
const { workspaces, channels, conversations, conversationEvaluations, objections, plans } = schema;

function fakeRedis(setResult: 'OK' | null = 'OK'): RedisLike {
  return {
    set: vi.fn(async () => setResult),
    eval: vi.fn(async () => 1),
  };
}

function okJudge(): JudgePort {
  return {
    evaluate: vi.fn(async () => ({
      result: {
        quality_score: 84,
        quality_rationale: 'ok',
        sentiment_score: 20,
        csat_label: 'neutral' as const,
        handled_by: 'human' as const,
        objections: [
          { category: 'price' as const, label: 'caro', excerpt: 'ta caro', resolved: false },
        ],
      },
      judge_model: 'openai/gpt-4o-mini',
      judge_cost_usd: 0.00012,
    })),
  };
}

async function seedClosedConversation(workspaceId: string): Promise<string> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId,
      provider: 'meta_whatsapp',
      name: `WA ev ${sfx}`,
      phoneNumberId: `pnid-ev-${sfx}`,
      wabaId: `waba-ev-${sfx}`,
    })
    .returning();
  if (!ch) throw new Error('channel');
  const [conv] = await db
    .insert(conversations)
    .values({ workspaceId, channelId: ch.id, remoteId: `rem-ev-${sfx}`, status: 'closed' })
    .returning();
  if (!conv) throw new Error('conversation');
  return conv.id;
}

afterAll(async () => {
  await closeDb();
});

describe('runEvaluationTick', () => {
  it('pula quando o lock e detido por outra instancia', async () => {
    const res = await runEvaluationTick({ redis: fakeRedis(null), logger, judge: okJudge() });
    expect(res.ran).toBe(false);
  });

  it('avalia conversa encerrada sem avaliacao e persiste eval + objections', async () => {
    const db = getDb();
    const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(workspaces)
      .values({ name: `Eval ${sfx}`, slug: `eval-${sfx}`, planId: free?.id ?? null })
      .returning();
    if (!w) throw new Error('ws');
    try {
      const convId = await seedClosedConversation(w.id);

      const res = await runEvaluationTick({ redis: fakeRedis(), logger, judge: okJudge() });
      expect(res.ran).toBe(true);
      expect(res.evaluated).toBeGreaterThan(0);

      const evals = await withWorkspace(w.id, (tx) =>
        tx
          .select()
          .from(conversationEvaluations)
          .where(eq(conversationEvaluations.conversationId, convId)),
      );
      expect(evals.length).toBe(1);
      expect(evals[0]?.qualityScore).toBe(84);
      expect(evals[0]?.handledBy).toBe('human');
      expect(evals[0]?.csatLabel).toBe('neutral');

      const objs = await withWorkspace(w.id, (tx) =>
        tx.select().from(objections).where(eq(objections.conversationId, convId)),
      );
      expect(objs.length).toBe(1);
      expect(objs[0]?.category).toBe('price');
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, w.id));
    }
  });

  it('idempotente: rodar 2x nao duplica avaliacao', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(workspaces)
      .values({ name: `EvalIdem ${sfx}`, slug: `evalidem-${sfx}` })
      .returning();
    if (!w) throw new Error('ws');
    try {
      const convId = await seedClosedConversation(w.id);
      const judge = okJudge();

      await runEvaluationTick({ redis: fakeRedis(), logger, judge });
      await runEvaluationTick({ redis: fakeRedis(), logger, judge });

      const evals = await withWorkspace(w.id, (tx) =>
        tx
          .select()
          .from(conversationEvaluations)
          .where(eq(conversationEvaluations.conversationId, convId)),
      );
      expect(evals.length).toBe(1); // UNIQUE(conversation_id) garante 1
      // Segundo tick nao re-seleciona ESTA conversa (LEFT JOIN ja exclui avaliadas):
      // o judge e chamado exatamente 1x para convId no total dos 2 ticks.
      const callsForConv = (judge.evaluate as unknown as { mock: { calls: [{ conversation_id: string }][] } }).mock.calls.filter(
        (c) => c[0].conversation_id === convId,
      );
      expect(callsForConv.length).toBe(1);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, w.id));
    }
  });

  it('falha do judge nao persiste avaliacao parcial', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(workspaces)
      .values({ name: `EvalFail ${sfx}`, slug: `evalfail-${sfx}` })
      .returning();
    if (!w) throw new Error('ws');
    try {
      const convId = await seedClosedConversation(w.id);
      const failing: JudgePort = {
        evaluate: vi.fn(async () => {
          throw new Error('judge 422 invalid output');
        }),
      };

      const res = await runEvaluationTick({ redis: fakeRedis(), logger, judge: failing });
      expect(res.ran).toBe(true);
      expect(res.failed).toBeGreaterThan(0);

      const evals = await withWorkspace(w.id, (tx) =>
        tx
          .select()
          .from(conversationEvaluations)
          .where(eq(conversationEvaluations.conversationId, convId)),
      );
      expect(evals.length).toBe(0); // nada persistido em falha
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, w.id));
    }
  });
});
