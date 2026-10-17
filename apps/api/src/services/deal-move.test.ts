/**
 * `moveDealToStage` (F5-S05) — não regressão do caminho comum + a opção `origin: 'undo'`
 * (F73-S08), contra o Postgres de dev.
 *
 * Caminho comum (sem `origin`, sem `afterCommit`): `allowedFromStageIds` vale, o seam roda ao
 * fim da função (antes do commit do chamador, como sempre foi), as automações `on_exit`/
 * `on_enter` são agendadas e o histórico não ganha metadados.
 *
 * `origin: 'undo'`: ignora `allowedFromStageIds`, mantém `requiredRoles`, não agenda automação e
 * cancela as `pending_automations` pendentes da proposta desfeita. `afterCommit`: o seam só roda
 * quando a fila é drenada.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import {
  AUTOMATION_CANCELLED_BY_UNDO,
  TransitionError,
  __resetStageChangeHooks,
  moveDealToStage,
  onStageChanged,
  type StageChangeEvent,
} from './deal-move';
import { scheduleStageAutomations } from './deal-hooks';

type AutomationRule = schema.AutomationRule;

let wsId = '';
let memberId = '';
let pipelineId = '';
let contactId = '';
const stage = { a: '', b: '', locked: '', admins: '' };
const seen: StageChangeEvent[] = [];

function rule(trigger: 'on_enter' | 'on_exit', delaySeconds = 3600): AutomationRule {
  return {
    id: randomUUID(),
    trigger,
    action: 'remove_tag',
    config: { kind: 'remove_tag', tagId: randomUUID() },
    delaySeconds,
    enabled: true,
  };
}

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: `DealMove ${sfx}`, slug: `deal-move-${sfx}` })
    .returning();
  if (!ws) throw new Error('ws');
  wsId = ws.id;
  const [m] = await db
    .insert(schema.members)
    .values({
      workspaceId: wsId,
      authUserId: randomUUID(),
      email: `dm-${sfx}@t.local`,
      name: 'Dona',
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: wsId, displayName: 'Cliente' })
    .returning();
  const [p] = await db
    .insert(schema.pipelines)
    .values({ workspaceId: wsId, name: 'Funil' })
    .returning();
  if (!m || !c || !p) throw new Error('seed');
  memberId = m.id;
  contactId = c.id;
  pipelineId = p.id;
  const rows = await db
    .insert(schema.stages)
    .values([
      { workspaceId: wsId, pipelineId, name: 'A', position: 0, automationRules: [rule('on_exit')] },
      {
        workspaceId: wsId,
        pipelineId,
        name: 'B',
        position: 1,
        automationRules: [rule('on_enter')],
      },
      { workspaceId: wsId, pipelineId, name: 'Travado', position: 2 },
      {
        workspaceId: wsId,
        pipelineId,
        name: 'Só gestão',
        position: 3,
        transitionRules: { requiredRoles: ['ADMIN'] },
      },
    ])
    .returning();
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  stage.a = byName.get('A') ?? '';
  stage.b = byName.get('B') ?? '';
  stage.locked = byName.get('Travado') ?? '';
  stage.admins = byName.get('Só gestão') ?? '';
  // "Travado" só aceita entrada vinda de "Só gestão".
  await db
    .update(schema.stages)
    .set({ transitionRules: { allowedFromStageIds: [stage.admins] } })
    .where(eq(schema.stages.id, stage.locked));
});

afterAll(async () => {
  __resetStageChangeHooks();
  if (wsId) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, wsId));
  await closeDb();
});

beforeEach(() => {
  __resetStageChangeHooks();
  seen.length = 0;
  onStageChanged((e) => {
    seen.push(e);
  });
  // O agendamento real de automações (o mesmo do hook de produção).
  onStageChanged((e) => scheduleStageAutomations(e));
});

async function newDeal(stageId: string): Promise<string> {
  const [d] = await getDb()
    .insert(schema.deals)
    .values({
      workspaceId: wsId,
      pipelineId,
      stageId,
      contactId,
      title: 'Negócio',
      valueCents: 100,
    })
    .returning();
  if (!d) throw new Error('deal');
  return d.id;
}

const owner = () => ({ type: 'member' as const, memberId, role: 'OWNER' as const });

async function pending(dealId: string) {
  return getDb()
    .select({
      status: schema.pendingAutomations.status,
      lastError: schema.pendingAutomations.lastError,
      rule: schema.pendingAutomations.rule,
    })
    .from(schema.pendingAutomations)
    .where(eq(schema.pendingAutomations.dealId, dealId));
}

describe('caminho comum (não regressão)', () => {
  it('move, grava histórico sem metadados, agenda on_exit + on_enter e emite o seam na hora', async () => {
    const id = await newDeal(stage.a);
    const moved = await withWorkspace(wsId, async (tx) => {
      const r = await moveDealToStage(tx, {
        dealId: id,
        newStageId: stage.b,
        actor: owner(),
        workspaceId: wsId,
      });
      // Comportamento histórico: o seam já rodou ANTES do commit do chamador.
      expect(seen).toHaveLength(1);
      return r;
    });
    expect(moved.fromStageId).toBe(stage.a);
    expect(moved.toStageId).toBe(stage.b);
    expect(seen[0]).toMatchObject({ dealId: id, fromStageId: stage.a, toStageId: stage.b });
    expect(seen[0]?.origin).toBeUndefined();
    const [hist] = await getDb()
      .select({ metadata: schema.dealHistory.metadata, actor: schema.dealHistory.actorMemberId })
      .from(schema.dealHistory)
      .where(eq(schema.dealHistory.dealId, id));
    expect(hist).toEqual({ metadata: null, actor: memberId });
    const rows = await pending(id);
    expect(rows.map((r) => r.rule.trigger).sort()).toEqual(['on_enter', 'on_exit']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.every((r) => !('metadata' in r.rule))).toBe(true);
  });

  it('allowedFromStageIds e requiredRoles continuam recusando; no-op para o mesmo estágio', async () => {
    const id = await newDeal(stage.a);
    await expect(
      withWorkspace(wsId, (tx) =>
        moveDealToStage(tx, {
          dealId: id,
          newStageId: stage.locked,
          actor: owner(),
          workspaceId: wsId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'transition_not_allowed' });
    await expect(
      withWorkspace(wsId, (tx) =>
        moveDealToStage(tx, {
          dealId: id,
          newStageId: stage.admins,
          actor: owner(),
          workspaceId: wsId,
        }),
      ),
    ).rejects.toBeInstanceOf(TransitionError);
    const same = await withWorkspace(wsId, (tx) =>
      moveDealToStage(tx, { dealId: id, newStageId: stage.a, actor: owner(), workspaceId: wsId }),
    );
    expect(same.fromStageId).toBe(same.toStageId);
    expect(seen).toHaveLength(0);
  });
});

describe("origin: 'undo' e afterCommit (F73-S08)", () => {
  it('afterCommit adia o seam até a fila ser drenada; a correlação vai para o histórico e as automações', async () => {
    const id = await newDeal(stage.a);
    const proposalId = randomUUID();
    const queue: (() => void | Promise<void>)[] = [];
    await withWorkspace(wsId, (tx) =>
      moveDealToStage(tx, {
        dealId: id,
        newStageId: stage.b,
        actor: owner(),
        workspaceId: wsId,
        metadata: { via: 'copilot', proposal_id: proposalId },
        afterCommit: (fn) => queue.push(fn),
      }),
    );
    expect(seen).toHaveLength(0);
    expect(queue).toHaveLength(1);
    for (const fn of queue) await fn();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.metadata).toEqual({ via: 'copilot', proposal_id: proposalId });
    const rows = await pending(id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect((r.rule as unknown as Record<string, unknown>)['metadata']).toEqual({
        via: 'copilot',
        proposal_id: proposalId,
      });
    }
  });

  it('desfazer ignora allowedFromStageIds, não agenda nada e cancela as pendentes da proposta', async () => {
    // Negócio em "Travado" (só se entra vindo de "Só gestão"); o Copiloto o levou para B.
    const id = await newDeal(stage.locked);
    const proposalId = randomUUID();
    await withWorkspace(wsId, (tx) =>
      moveDealToStage(tx, {
        dealId: id,
        newStageId: stage.b,
        actor: owner(),
        workspaceId: wsId,
        metadata: { via: 'copilot', proposal_id: proposalId },
      }),
    );
    // Uma automação de outra origem no mesmo negócio fica intocada.
    await getDb()
      .insert(schema.pendingAutomations)
      .values({
        workspaceId: wsId,
        dealId: id,
        rule: rule('on_enter'),
        scheduledAt: new Date(Date.now() + 60_000),
        status: 'pending',
      });
    const before = await pending(id);
    expect(before.filter((r) => r.status === 'pending')).toHaveLength(2);
    seen.length = 0;

    await withWorkspace(wsId, (tx) =>
      moveDealToStage(tx, {
        dealId: id,
        newStageId: stage.locked,
        actor: owner(),
        workspaceId: wsId,
        origin: 'undo',
        metadata: { via: 'copilot', proposal_id: proposalId },
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.origin).toBe('undo');
    const after = await pending(id);
    const tagged = after.filter(
      (r) => (r.rule as unknown as Record<string, unknown>)['metadata'] !== undefined,
    );
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({ status: 'failed', lastError: AUTOMATION_CANCELLED_BY_UNDO });
    // Nada novo: continuam 2 linhas (a cancelada e a de outra origem, ainda pendente).
    expect(after).toHaveLength(2);
    expect(after.filter((r) => r.status === 'pending')).toHaveLength(1);
    const [hist] = await getDb()
      .select({ metadata: schema.dealHistory.metadata })
      .from(schema.dealHistory)
      .where(
        and(eq(schema.dealHistory.dealId, id), eq(schema.dealHistory.eventType, 'stage_changed')),
      )
      .orderBy(schema.dealHistory.createdAt)
      .offset(1);
    expect(hist?.metadata).toEqual({ via: 'copilot', proposal_id: proposalId, origin: 'undo' });
  });

  it('desfazer mantém requiredRoles', async () => {
    const id = await newDeal(stage.b);
    await expect(
      withWorkspace(wsId, (tx) =>
        moveDealToStage(tx, {
          dealId: id,
          newStageId: stage.admins,
          actor: owner(),
          workspaceId: wsId,
          origin: 'undo',
        }),
      ),
    ).rejects.toMatchObject({ code: 'role_not_allowed' });
  });
});
