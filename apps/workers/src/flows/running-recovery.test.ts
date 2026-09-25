/**
 * F70-S25 — recuperação de execução de flow `running` parada (Postgres dev):
 *  - duas instâncias concorrentes de `recoverStaleRunning` (o lock Redis do scheduler fora
 *    do caminho): a execução parada é reivindicada por UMA só — um job na outbox;
 *  - a rodada seguinte não a reanima de novo (a reivindicação renovou o relógio);
 *  - a recente (dentro do limite) e a `waiting` ficam intactas; a velha demais vira
 *    `failed` com o motivo, sem job;
 *  - o passo reanimado roda UMA vez, mesmo com o envelope original chegando junto (claim
 *    atômico do consumer), e o avanço grava o próximo passo pela outbox;
 *  - o tick do scheduler leva a recuperação e devolve as contagens.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { FlowStepInFlightError, processFlowStepScoped } from '@hm/flow-engine';
import { parseFlowExecutionStep } from '@hm/shared/mq';
import { createLogger } from '@hm/logger';
import { outboxRowsOf } from '../outbox/testing';
import {
  FLOW_RUNNING_EXPIRED_ERROR,
  recoverStaleRunning,
  runFlowWakeupTick,
  type RunningRecoveryConfig,
} from './scheduler';

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const FLOW = randomUUID();
let VERSION = '';

const CONFIG: RunningRecoveryConfig = { staleAfterMs: 5 * 60_000, maxAgeMs: 24 * 60 * 60_000 };

const NODES = [
  { id: 'n_trigger', type: 'trigger', data: {} },
  { id: 'n_set', type: 'set_variable', data: { name: 'x', value: '1' } },
];
const EDGES = [{ id: 'e1', source: 'n_trigger', target: 'n_set' }];

/** Execução numa situação dada, com o relógio `updated_at` (ou `started_at`) no passado. */
async function execution(
  status: 'running' | 'waiting',
  idleMs: number,
  opts: { neverUpdated?: boolean } = {},
): Promise<string> {
  const at = sql`now() - (${idleMs}::double precision * interval '1 millisecond')`;
  const [row] = await getDb()
    .insert(schema.flowExecutions)
    .values({
      workspaceId: WS,
      flowId: FLOW,
      flowVersionId: VERSION,
      triggeredBy: 'automatic',
      status,
      currentNodeId: 'n_trigger',
      variables: {},
      startedAt: at,
      updatedAt: opts.neverUpdated === true ? null : at,
      ...(status === 'waiting' ? { nextStepAt: new Date(Date.now() + 60 * 60_000) } : {}),
    })
    .returning({ id: schema.flowExecutions.id });
  if (!row) throw new Error('fixture: execução');
  return row.id;
}

async function stepJobsOf(executionId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.routingKey === 'hm.q.flow.execution' &&
      parseFlowExecutionStep(r.envelope.payload).executionId === executionId,
  );
}

async function rowOf(executionId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.flowExecutions)
    .where(eq(schema.flowExecutions.id, executionId));
  return row;
}

async function logsOf(executionId: string, nodeId: string) {
  return getDb()
    .select({ id: schema.flowLogs.id })
    .from(schema.flowLogs)
    .where(and(eq(schema.flowLogs.executionId, executionId), eq(schema.flowLogs.nodeId, nodeId)));
}

function ours(list: readonly { executionId: string }[], ids: readonly string[]): string[] {
  return list.map((r) => r.executionId).filter((id) => ids.includes(id));
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S25 recovery', slug: `f70s25-rc-${WS.slice(0, 8)}` });
  await db
    .insert(schema.flows)
    .values({
      id: FLOW,
      workspaceId: WS,
      name: 'Recuperação',
      triggerType: 'manual',
      status: 'active',
    });
  const [version] = await db
    .insert(schema.flowVersions)
    .values({ flowId: FLOW, version: 1, nodes: NODES, edges: EDGES, triggerConfig: {} })
    .returning({ id: schema.flowVersions.id });
  VERSION = version?.id ?? '';
});

afterAll(async () => {
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('recuperação de running parada (F70-S25)', () => {
  it('duas instâncias concorrentes: a parada é reanimada UMA vez; as demais ficam como devem', async () => {
    const stale = await execution('running', 10 * 60_000);
    const staleNeverUpdated = await execution('running', 10 * 60_000, { neverUpdated: true });
    const fresh = await execution('running', 60_000);
    const waiting = await execution('waiting', 10 * 60_000);
    const tooOld = await execution('running', 2 * 24 * 60 * 60_000);
    const mine = [stale, staleNeverUpdated, fresh, waiting, tooOld];

    const [a, b] = await Promise.all([
      recoverStaleRunning(CONFIG, 200),
      recoverStaleRunning(CONFIG, 200),
    ]);
    const recovered = [...ours(a.recovered, mine), ...ours(b.recovered, mine)];
    expect(recovered.sort()).toEqual([stale, staleNeverUpdated].sort());
    const expired = [...ours(a.expired, mine), ...ours(b.expired, mine)];
    expect(expired).toEqual([tooOld]);

    // Um job por execução reanimada — não dois.
    expect(await stepJobsOf(stale)).toHaveLength(1);
    expect(await stepJobsOf(staleNeverUpdated)).toHaveLength(1);
    expect(await stepJobsOf(fresh)).toHaveLength(0);
    expect(await stepJobsOf(waiting)).toHaveLength(0);
    expect(await stepJobsOf(tooOld)).toHaveLength(0);

    expect((await rowOf(stale))?.status).toBe('running');
    expect((await rowOf(fresh))?.status).toBe('running');
    expect((await rowOf(waiting))?.status).toBe('waiting');
    expect(await rowOf(tooOld)).toMatchObject({
      status: 'failed',
      lastError: FLOW_RUNNING_EXPIRED_ERROR,
    });

    // A rodada seguinte não reanima de novo (o relógio foi renovado na reivindicação).
    const again = await recoverStaleRunning(CONFIG, 200);
    expect(ours(again.recovered, mine)).toEqual([]);
    expect(ours(again.expired, mine)).toEqual([]);
    expect(await stepJobsOf(stale)).toHaveLength(1);
  });

  it('o passo reanimado roda UMA vez, mesmo com o envelope original chegando junto', async () => {
    const exec = await execution('running', 10 * 60_000);
    const res = await recoverStaleRunning(CONFIG, 200);
    expect(ours(res.recovered, [exec])).toEqual([exec]);

    // Job reanimado + envelope original atrasado, entregues ao mesmo tempo.
    const outcomes = await Promise.allSettled([
      processFlowStepScoped(WS, exec),
      processFlowStepScoped(WS, exec),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(FlowStepInFlightError);

    // O nó do passo rodou uma vez; a execução avançou e o próximo passo foi pela outbox.
    expect(await logsOf(exec, 'n_trigger')).toHaveLength(1);
    expect(await rowOf(exec)).toMatchObject({ status: 'running', currentNodeId: 'n_set' });
    expect(await stepJobsOf(exec)).toHaveLength(2);

    // O retry do perdedor encontra a execução adiante: roda o PRÓXIMO nó, nunca o mesmo.
    await processFlowStepScoped(WS, exec);
    expect(await logsOf(exec, 'n_trigger')).toHaveLength(1);
    expect(await logsOf(exec, 'n_set')).toHaveLength(1);
    expect((await rowOf(exec))?.status).toBe('completed');
  });

  it('o tick do scheduler roda a recuperação e devolve as contagens', async () => {
    const exec = await execution('running', 10 * 60_000);
    const redis = {
      set: async () => 'OK' as const,
      eval: async () => 1,
    };
    const res = await runFlowWakeupTick(
      {
        redis,
        channel: { publish: () => true } as never,
        logger: createLogger('error'),
        selectDue: async () => [],
        runningRecovery: CONFIG,
      },
      {},
    );
    expect(res.ran).toBe(true);
    expect(res.recovered).toBeGreaterThanOrEqual(1);
    expect(await stepJobsOf(exec)).toHaveLength(1);
  });
});
