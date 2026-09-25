/**
 * F70-S25 — o passo de flow (`hm.q.flow.execution`) entra na outbox na transação da
 * execução (Postgres dev, RLS real do `withWorkspace`):
 *  - `createExecution`: a execução `running` e o job do primeiro passo commitam juntos;
 *    rollback forçado não deixa nenhum dos dois;
 *  - `patchExecution({ enqueueStep })`: o próximo passo só entra se a transição aplicou —
 *    o patch recusado pelo fencing (claim perdido) não ressuscita a execução;
 *  - `go_to_flow`: o flow filho nasce com o próprio passo, na transação que o cria;
 *  - a engine DEFAULT (a dos triggers do inbound e da API v1, que usava um sink em memória
 *    e nunca publicava) agora grava o passo.
 *
 * A outbox é lida pela conexão do processo (outra transação): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';

const FORCED = 'F70-S25: rollback forçado pelo teste';
const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const withWorkspace: typeof actual.withWorkspace = (workspaceId, fn) =>
    actual.withWorkspace(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (rollback.armed) throw new Error(FORCED);
      return out;
    });
  return { ...actual, withWorkspace };
});

const { closeDb, getDb, schema } = await import('@hm/db');
const { envelopeSchema, parseFlowExecutionStep } = await import('@hm/shared/mq');
const { flowDbPort } = await import('./db.port');
const { goToFlowHandler } = await import('../handlers/go_to_flow.handler');
const { triggerFlow } = await import('../index');
type Ctx = Parameters<typeof goToFlowHandler.execute>[1];

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const FLOW = randomUUID();
const CHILD_FLOW = randomUUID();

const NODES = [
  { id: 'n_trigger', type: 'trigger', data: {} },
  { id: 'n_set', type: 'set_variable', data: { name: 'x', value: '1' } },
];
const EDGES = [{ id: 'e1', source: 'n_trigger', target: 'n_set' }];

async function stepJobsOf(executionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.outbox)
    .where(
      and(eq(schema.outbox.workspaceId, WS), eq(schema.outbox.routingKey, 'hm.q.flow.execution')),
    )
    .orderBy(asc(schema.outbox.id));
  return rows
    .map((r) => ({ ...r, envelope: envelopeSchema.parse(r.envelope) }))
    .filter((r) => parseFlowExecutionStep(r.envelope.payload).executionId === executionId);
}

async function executionsOf(flowId: string) {
  return getDb()
    .select()
    .from(schema.flowExecutions)
    .where(eq(schema.flowExecutions.flowId, flowId));
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S25 flows', slug: `f70s25-fl-${WS.slice(0, 8)}` });
  await db.insert(schema.flows).values([
    { id: FLOW, workspaceId: WS, name: 'Pai', triggerType: 'manual', status: 'active' },
    { id: CHILD_FLOW, workspaceId: WS, name: 'Filho', triggerType: 'manual', status: 'active' },
  ]);
  await db.insert(schema.flowVersions).values([
    { flowId: FLOW, version: 1, nodes: NODES, edges: EDGES, triggerConfig: {} },
    { flowId: CHILD_FLOW, version: 1, nodes: NODES, edges: EDGES, triggerConfig: {} },
  ]);
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('createExecution → primeiro passo na outbox (F70-S25)', () => {
  it('commit: execução running e UM job de passo com o contrato do consumer', async () => {
    const { executionId } = await flowDbPort.createExecution({
      workspaceId: WS,
      flowId: FLOW,
      triggeredBy: 'manual',
      variables: {},
    });
    const [exec] = (await executionsOf(FLOW)).filter((e) => e.id === executionId);
    expect(exec).toMatchObject({ status: 'running', currentNodeId: 'n_trigger' });

    const jobs = await stepJobsOf(executionId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '', routingKey: 'hm.q.flow.execution' });
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelope.id);
    expect(jobs[0]?.envelope).toMatchObject({ type: 'flow.execution.step', workspaceId: WS });
    expect(parseFlowExecutionStep(jobs[0]?.envelope.payload)).toEqual({
      workspaceId: WS,
      executionId,
    });
  });

  it('rollback: nem a execução nem o job ficam', async () => {
    const before = (await executionsOf(FLOW)).length;
    rollback.armed = true;
    await expect(
      flowDbPort.createExecution({
        workspaceId: WS,
        flowId: FLOW,
        triggeredBy: 'manual',
        variables: {},
      }),
    ).rejects.toThrow(FORCED);
    rollback.armed = false;
    expect(await executionsOf(FLOW)).toHaveLength(before);
  });

  it('a engine default (triggers do inbound, API v1) grava o passo de verdade', async () => {
    const { executionId } = await triggerFlow({
      workspaceId: WS,
      flowId: FLOW,
      triggeredBy: 'api',
      triggerData: { source: 'f70s25' },
    });
    expect(await stepJobsOf(executionId)).toHaveLength(1);
  });
});

describe.skipIf(!ready)(
  'patchExecution({ enqueueStep }) → próximo passo com a transição (F70-S25)',
  () => {
    async function processing(): Promise<string> {
      const { executionId } = await flowDbPort.createExecution({
        workspaceId: WS,
        flowId: FLOW,
        triggeredBy: 'manual',
        variables: {},
      });
      const claim = await flowDbPort.claimExecution(WS, executionId);
      expect(claim.claimed).toBe(true);
      return executionId;
    }

    it('transição aplicada: grava o próximo passo junto', async () => {
      const executionId = await processing();
      const applied = await flowDbPort.patchExecution(
        WS,
        executionId,
        { status: 'running', currentNodeId: 'n_set' },
        { expectStatus: ['processing'], enqueueStep: true },
      );
      expect(applied).toBe(true);
      // O da criação + o do avanço.
      expect(await stepJobsOf(executionId)).toHaveLength(2);
    });

    it('transição recusada pelo fencing (claim perdido): nenhum passo novo', async () => {
      const executionId = await processing();
      await flowDbPort.patchExecution(WS, executionId, { status: 'cancelled' });
      const applied = await flowDbPort.patchExecution(
        WS,
        executionId,
        { status: 'running', currentNodeId: 'n_set' },
        { expectStatus: ['processing'], enqueueStep: true },
      );
      expect(applied).toBe(false);
      expect(await stepJobsOf(executionId)).toHaveLength(1);
    });

    it('rollback: nem a transição nem o passo ficam', async () => {
      const executionId = await processing();
      rollback.armed = true;
      await expect(
        flowDbPort.patchExecution(
          WS,
          executionId,
          { status: 'running', currentNodeId: 'n_set' },
          { expectStatus: ['processing'], enqueueStep: true },
        ),
      ).rejects.toThrow(FORCED);
      rollback.armed = false;

      const [exec] = (await executionsOf(FLOW)).filter((e) => e.id === executionId);
      expect(exec?.status).toBe('processing');
      expect(await stepJobsOf(executionId)).toHaveLength(1);
    });
  },
);

describe.skipIf(!ready)('go_to_flow → flow filho nasce com o próprio passo (F70-S25)', () => {
  function ctx(): Ctx {
    return {
      workspaceId: WS,
      executionId: randomUUID(),
      flowId: FLOW,
      conversationId: null,
      contactId: null,
      variables: {},
      sendMessage: async () => undefined,
      sendPresence: async () => undefined,
      setConversationAi: async () => ({ applied: true }),
      setConversationStatus: async () => undefined,
      httpRequest: async () => ({ status: 200, ok: true, body: null, headers: {} }),
      log: () => undefined,
      now: () => new Date(),
      sleep: async () => undefined,
    };
  }
  const node = { id: 'n_goto', type: 'go_to_flow', data: { flowId: CHILD_FLOW } };

  it('commit: execução do filho e UM job de passo dela', async () => {
    const result = await goToFlowHandler.execute(node, ctx());
    expect(result.status).toBe('SUCCESS');
    const childId =
      'variables' in result ? String(result.variables?.['_goto_flow_execution_id']) : '';
    const [child] = (await executionsOf(CHILD_FLOW)).filter((e) => e.id === childId);
    expect(child).toMatchObject({ status: 'running', triggeredBy: 'automatic' });
    expect(await stepJobsOf(childId)).toHaveLength(1);
  });

  it('rollback: nem o filho nem o passo dele', async () => {
    const before = (await executionsOf(CHILD_FLOW)).length;
    rollback.armed = true;
    await expect(goToFlowHandler.execute(node, ctx())).rejects.toThrow(FORCED);
    rollback.armed = false;
    expect(await executionsOf(CHILD_FLOW)).toHaveLength(before);
  });
});
