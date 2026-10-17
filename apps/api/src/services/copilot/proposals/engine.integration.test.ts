/**
 * F73-S05 — motor de propostas contra o Postgres de dev, com executores FAKE (sem domínio).
 *
 * Cobre o DoD do slot: nível 2 na hora + desfazer; 3 e 4 persistem e expiram; confirmar em
 * paralelo = uma execução; idempotência por chave; versão; "Revisei"; papel rebaixado; só
 * leitura; conflito por versão; Parar; retomada por lease; desfazer com conflito e fora da
 * janela; tentar de novo; aprovação; turno contaminado; e a trilha (linhas de audit_logs).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  copilotProposalsRepo,
  copilotTurnsRepo,
  getDb,
  schema,
  withWorkspace,
  type CopilotProposalRow,
} from '@hm/db';
import { CopilotToolEnvelopeSchema, type Role } from '@hm/shared';
import { resolveCopilotPrincipal, type CopilotPrincipal } from '../identity/principal';
import {
  seedCopilotTurn,
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../identity/test-fixtures';
import { cancelProposal } from './cancel';
import { confirmProposal, type ConfirmInput } from './confirm';
import { listApprovers, requestApproval } from './approval';
import { drainProposalExecutions, runProposalExecution, startProposalExecution } from './execute';
import { makeProposeTool, proposeAction, proposeEnvelope, type ProposeOutcome } from './propose';
import { retryFailedItems } from './retry';
import { startProposalSweeper, sweepProposalsOnce } from './sweeper';
import {
  FakeStore,
  fakeSweepRedis,
  makeTestDeps,
  type FakeArgs,
  type TestDeps,
} from './test-fixtures';
import { undoProposal } from './undo';

let seeded: SeededWorkspace;
let store: FakeStore;
let deps: TestDeps;

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Proposals' });
});

afterAll(async () => {
  await drainProposalExecutions();
  await seeded?.cleanup();
  await closeDb();
});

beforeEach(() => {
  store = new FakeStore();
  deps = makeTestDeps(store);
});

const ws = (): string => seeded.workspaceId;
const memberId = (role: Role): string => seeded.members[role].id;

async function principalIn(
  tx: Parameters<Parameters<typeof withWorkspace>[1]>[0],
  role: Role,
): Promise<CopilotPrincipal> {
  const p = await resolveCopilotPrincipal(tx, { workspaceId: ws(), memberId: memberId(role) });
  if (!p) throw new Error(`principal ${role}`);
  return p;
}

function newIds(n: number): string[] {
  return Array.from({ length: n }, () => {
    const id = randomUUID();
    store.add(id);
    return id;
  });
}

async function propose(
  role: Role,
  capability: 'deal.move' | 'campaign.pause',
  args: FakeArgs,
  extra: { turnId?: string; sessionId?: string; turnTainted?: boolean } = {},
): Promise<ProposeOutcome> {
  const executor = deps.executors.get(capability);
  if (!executor) throw new Error('executor');
  return withWorkspace(ws(), async (tx) =>
    proposeAction(
      deps,
      {
        tx,
        principal: await principalIn(tx, role),
        source: 'copilot',
        turnId: extra.turnId ?? null,
        sessionId: extra.sessionId ?? null,
        ...(extra.turnTainted !== undefined ? { turnTainted: extra.turnTainted } : {}),
      },
      executor,
      args,
    ),
  );
}

function persistedRow(outcome: ProposeOutcome): CopilotProposalRow {
  if (!('row' in outcome)) throw new Error(`sem proposta: ${outcome.kind}`);
  return outcome.row;
}

async function confirm(role: Role, id: string, input: Partial<ConfirmInput> & { version: number }) {
  return withWorkspace(ws(), async (tx) =>
    confirmProposal(deps, tx, await principalIn(tx, role), id, {
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      ...input,
    }),
  );
}

async function confirmAndRun(role: Role, row: CopilotProposalRow, acknowledged = false) {
  const out = await confirm(role, row.id, { version: row.version, acknowledged });
  if (!out.ok) throw new Error(`confirm: ${out.error}`);
  const final = out.start ? await out.start() : null;
  return { out, final };
}

async function load(id: string) {
  const got = await withWorkspace(ws(), (tx) => copilotProposalsRepo.getWithItems(tx, id));
  if (!got) throw new Error('proposta sumiu');
  return got;
}

async function auditRows(proposalId: string) {
  return getDb()
    .select({
      action: schema.auditLogs.action,
      actorType: schema.auditLogs.actorType,
      actor: schema.auditLogs.actorMemberId,
      requestedBy: schema.auditLogs.requestedByMemberId,
      metadata: schema.auditLogs.metadata,
    })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.copilotProposalId, proposalId))
    .orderBy(schema.auditLogs.createdAt);
}

async function undo(role: Role, id: string, key = randomUUID()) {
  const viewer = await withWorkspace(ws(), (tx) => principalIn(tx, role));
  return undoProposal(deps, viewer, id, key);
}

describe('nível 2: executa na hora e desfaz', () => {
  it('1 alvo → completed com recibo, desfazer volta o estado; trilha com 4 linhas', async () => {
    const [id] = newIds(1);
    const outcome = await propose('OWNER', 'deal.move', { ids: [id!], to: 'Reativação' });
    expect(outcome.kind).toBe('executed');
    const row = persistedRow(outcome);
    expect(row.riskLevel).toBe(2);
    expect(row.status).toBe('completed');
    expect(row.executedAsMemberId).toBe(memberId('OWNER'));
    const hours = (row.undoDeadline!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(store.records.get(id!)?.value).toBe('Reativação');

    const envelope = CopilotToolEnvelopeSchema.parse(proposeEnvelope(outcome));
    expect(envelope.decision).toBe('executed');
    expect(envelope.public_event?.type).toBe('action_receipt');

    const undone = await undo('OWNER', row.id);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.row.status).toBe('undone');
    expect(undone.row.undoneBy).toBe(memberId('OWNER'));
    expect(store.records.get(id!)?.value).toBe('Orçamento enviado');

    const audit = await auditRows(row.id);
    expect(audit.map((a) => a.action)).toEqual([
      'copilot.proposal.executing',
      'copilot.proposal.completed',
      'copilot.proposal.undo_started',
      'copilot.proposal.undone',
    ]);
    expect(audit.every((a) => a.actorType === 'copilot')).toBe(true);
    expect(audit.every((a) => a.requestedBy === memberId('OWNER'))).toBe(true);
    expect(audit[0]?.metadata).toMatchObject({
      capability: 'deal.move',
      risk_level: 2,
      from: null,
    });
    // Sem PII: só chaves conhecidas na metadata.
    for (const a of audit) {
      expect(JSON.stringify(a.metadata)).not.toContain('Orçamento');
    }
  });

  it('desfazer de novo com a MESMA chave = mesmo resultado; outra chave = not_undoable', async () => {
    const [id] = newIds(1);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids: [id!], to: 'X' }));
    const key = randomUUID();
    const first = await undo('OWNER', row.id, key);
    expect(first.ok && first.row.status).toBe('undone');
    const again = await undo('OWNER', row.id, key);
    expect(again.ok && again.row.status).toBe('undone');
    expect(store.undoCalls.filter((x) => x === id)).toHaveLength(1);
    const other = await undo('OWNER', row.id);
    expect(!other.ok && other.error).toBe('not_undoable');
  });

  it('makeProposeTool gera propose_deal_move e o handler devolve envelope válido', async () => {
    const executor = deps.executors.get('deal.move')!;
    const tool = makeProposeTool(executor, { description: 'Mover negócios.', deps: () => deps });
    expect(tool.key).toBe('propose_deal_move');
    expect(tool.capability).toBe('deal.move');
    const secret = Buffer.alloc(32, 7);
    const turn = await seedCopilotTurn({ workspaceId: ws(), memberId: memberId('OWNER'), secret });
    const [id] = newIds(1);
    const envelope = await withWorkspace(ws(), async (tx) =>
      tool.handler(
        {
          tx,
          principal: await principalIn(tx, 'OWNER'),
          turn: {
            turnId: turn.turnId,
            workspaceId: ws(),
            memberId: memberId('OWNER'),
            sessionId: turn.sessionId,
            toolCalls: 1,
            maxToolCalls: 16,
            tainted: false,
            expiresAt: new Date(Date.now() + 60_000),
          },
          callId: 'c1',
          emitResult: () => {
            throw new Error('não usado');
          },
        },
        { ids: [id!], to: 'Y' },
      ),
    );
    expect(CopilotToolEnvelopeSchema.parse(envelope).decision).toBe('executed');
  });
});

describe('níveis 3 e 4: persistem e expiram', () => {
  it('lote (3) fica proposed por 15 min; nível 4 por 10 min; a varredura expira', async () => {
    const l3 = persistedRow(await propose('OWNER', 'deal.move', { ids: newIds(2), to: 'R' }));
    const l4 = persistedRow(await propose('OWNER', 'campaign.pause', { ids: newIds(1), to: 'P' }));
    expect([l3.status, l3.riskLevel]).toEqual(['proposed', 3]);
    expect([l4.status, l4.riskLevel]).toEqual(['proposed', 4]);
    const mins = (r: CopilotProposalRow) => (r.expiresAt!.getTime() - Date.now()) / 60_000;
    expect(mins(l3)).toBeGreaterThan(14.9);
    expect(mins(l3)).toBeLessThanOrEqual(15);
    expect(mins(l4)).toBeGreaterThan(9.9);
    expect(mins(l4)).toBeLessThanOrEqual(10);
    expect(l4.policyChecks).toHaveLength(1);
    expect(store.executeCalls).toHaveLength(0);

    await getDb()
      .update(schema.copilotActionProposals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.copilotActionProposals.id} in (${l3.id}, ${l4.id})`);
    const sweep = await sweepProposalsOnce(deps, fakeSweepRedis(), { awaitResumes: true });
    expect(sweep.locked).toBe(true);
    expect((await load(l3.id)).proposal.status).toBe('expired');
    expect((await load(l4.id)).proposal.status).toBe('expired');
    expect((await auditRows(l3.id)).map((a) => a.action)).toEqual([
      'copilot.proposal.proposed',
      'copilot.proposal.expired',
    ]);
    const late = await confirm('OWNER', l3.id, { version: l3.version + 1 });
    expect(!late.ok && late.error).toBe('proposal_expired');
  });

  it('a varredura não roda sem o lock', async () => {
    const redis = fakeSweepRedis();
    redis.store.set('hm:lock:scheduler:copilot-proposals', 'outra-replica');
    expect((await sweepProposalsOnce(deps, redis)).locked).toBe(false);
  });
});

describe('confirmar: idempotente, otimista e revalidado', () => {
  it('duas confirmações em paralelo com a mesma chave → uma execução (202 + 200)', async () => {
    const ids = newIds(3);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    const key = randomUUID();
    const [a, b] = await Promise.all([
      confirm('OWNER', row.id, { version: row.version, idempotencyKey: key }),
      confirm('OWNER', row.id, { version: row.version, idempotencyKey: key }),
    ]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(2);
    const statuses = [a, b].map((x) => (x.ok ? x.status : 0)).sort();
    expect(statuses).toEqual([200, 202]);
    for (const x of [a, b]) if (x.ok && x.start) await x.start();
    await drainProposalExecutions();
    for (const id of ids) expect(store.countExecutions(id)).toBe(1);
    expect((await load(row.id)).proposal.status).toBe('completed');
  });

  it('duas confirmações em paralelo com chaves diferentes → 202 + 409 already_confirmed', async () => {
    const ids = newIds(2);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    const results = await Promise.all([
      confirm('OWNER', row.id, { version: row.version }),
      confirm('OWNER', row.id, { version: row.version }),
    ]);
    const accepted = results.filter((r) => r.ok && r.status === 202);
    const refused = results.filter((r) => !r.ok);
    expect(accepted).toHaveLength(1);
    expect(refused.map((r) => (!r.ok ? r.error : ''))).toEqual(['already_confirmed']);
    for (const r of results) if (r.ok && r.start) await r.start();
    for (const id of ids) expect(store.countExecutions(id)).toBe(1);
  });

  it('mesma chave depois de concluída → mesmo resultado (200), sem reexecutar', async () => {
    const ids = newIds(2);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    const key = randomUUID();
    const first = await confirm('OWNER', row.id, { version: row.version, idempotencyKey: key });
    expect(first.ok && first.status).toBe(202);
    if (first.ok && first.start) await first.start();
    const again = await confirm('OWNER', row.id, { version: row.version, idempotencyKey: key });
    expect(again.ok && again.status).toBe(200);
    expect(again.ok && again.proposal.status).toBe('completed');
    expect(again.ok && again.start).toBeNull();
    for (const id of ids) expect(store.countExecutions(id)).toBe(1);
  });

  it('versão divergente → stale_proposal com a proposta atual', async () => {
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids: newIds(2), to: 'R' }));
    const out = await confirm('OWNER', row.id, { version: row.version + 5 });
    expect(!out.ok && out.error).toBe('stale_proposal');
    expect(!out.ok && out.proposal?.version).toBe(row.version);
  });

  it('nível 4 sem "Revisei" → ack_required; com ele, executa', async () => {
    const row = persistedRow(await propose('OWNER', 'campaign.pause', { ids: newIds(1), to: 'P' }));
    const out = await confirm('OWNER', row.id, { version: row.version });
    expect(!out.ok && out.error).toBe('ack_required');
    const ok = await confirm('OWNER', row.id, { version: row.version, acknowledged: true });
    expect(ok.ok && ok.status).toBe(202);
    const final = ok.ok && ok.start ? await ok.start() : null;
    expect(final?.status).toBe('completed');
    // Nível 4 sem desfazer declarado: sem janela.
    expect(final?.undoDeadline).toBeNull();
  });

  it('política recalculada no confirmar: bloqueio novo → policy_blocked', async () => {
    const row = persistedRow(await propose('OWNER', 'campaign.pause', { ids: newIds(1), to: 'P' }));
    store.policy = 'block';
    const out = await confirm('OWNER', row.id, { version: row.version, acknowledged: true });
    expect(!out.ok && out.error).toBe('policy_blocked');
    expect(!out.ok && out.proposal?.can_confirm).toBe(false);
  });

  it('papel rebaixado entre propor e confirmar → forbidden (403)', async () => {
    const row = persistedRow(await propose('AGENT', 'deal.move', { ids: newIds(2), to: 'R' }));
    expect(row.status).toBe('proposed');
    await getDb()
      .update(schema.members)
      .set({ role: 'READONLY' })
      .where(eq(schema.members.id, memberId('AGENT')));
    try {
      const out = await confirm('AGENT', row.id, { version: row.version });
      expect(!out.ok && out.error).toBe('forbidden');
    } finally {
      await getDb()
        .update(schema.members)
        .set({ role: 'AGENT' })
        .where(eq(schema.members.id, memberId('AGENT')));
    }
  });

  it('assinatura expirada no confirmar → subscription_inactive (402)', async () => {
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids: newIds(2), to: 'R' }));
    await getDb()
      .update(schema.workspaces)
      .set({ subscriptionStatus: 'expired' })
      .where(eq(schema.workspaces.id, ws()));
    try {
      const out = await confirm('OWNER', row.id, { version: row.version });
      expect(!out.ok && out.error).toBe('subscription_inactive');
    } finally {
      await getDb()
        .update(schema.workspaces)
        .set({ subscriptionStatus: 'active' })
        .where(eq(schema.workspaces.id, ws()));
    }
  });
});

describe('execução item a item', () => {
  it('conflito por versão em 2 de 7 → partially_completed com motivo ("Paula")', async () => {
    const ids = newIds(7);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'Reativação' }));
    store.touch(ids[1]!, 'Paula');
    store.touch(ids[4]!, 'Paula');
    const { final } = await confirmAndRun('OWNER', row);
    expect(final?.status).toBe('partially_completed');
    const { items } = await load(row.id);
    const skipped = items.filter((i) => i.status === 'skipped_conflict');
    expect(skipped.map((i) => i.targetId).sort()).toEqual([ids[1], ids[4]].sort());
    expect(skipped[0]?.errorCode).toBe('conflict');
    expect(skipped[0]?.after?.['conflict_by']).toBe('Paula');
    expect(items.filter((i) => i.status === 'done')).toHaveLength(5);
    // O progresso emitido fecha em "5 de 7".
    const last = deps.emitted.at(-1);
    expect(last?.payload).toMatchObject({
      status: 'partially_completed',
      progress: { done: 5, total: 7, failed: 2 },
    });
    const audit = await auditRows(row.id);
    expect(audit.at(-1)?.metadata).toMatchObject({
      to: 'partially_completed',
      counts: { done: 5, skipped: 2, total: 7 },
    });
  });

  it('Parar no meio → partially_completed, o que foi feito fica', async () => {
    const ids = newIds(4);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    let stop: Promise<unknown> | null = null;
    store.onExecute = (index) => {
      if (index === 1) {
        stop = withWorkspace(ws(), async (tx) =>
          cancelProposal(deps, tx, await principalIn(tx, 'OWNER'), row.id),
        );
      }
    };
    const out = await confirm('OWNER', row.id, { version: row.version });
    expect(out.ok && out.status).toBe(202);
    // O clique em "Parar" chega entre itens: o runner espera o commit dele antes do próximo.
    const final = await runProposalExecution(deps, {
      workspaceId: ws(),
      proposalId: row.id,
      run: async (fn) => {
        const result = await withWorkspace(ws(), fn);
        if (stop) await stop;
        return result;
      },
    });
    expect(final?.status).toBe('partially_completed');
    const { proposal, items } = await load(row.id);
    expect(proposal.stopRequested).toBe(true);
    expect(items.filter((i) => i.status === 'done')).toHaveLength(2);
    expect(items.filter((i) => i.status === 'pending')).toHaveLength(2);
    expect((await auditRows(row.id)).map((a) => a.action)).toContain(
      'copilot.proposal.stop_requested',
    );
  });

  it('lease vencido é retomado pela varredura sem duplicar item', async () => {
    const ids = newIds(4);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    const out = await confirm('OWNER', row.id, { version: row.version });
    expect(out.ok && out.status).toBe(202);
    // "Processo cai" no 3º item: load (1), principal (2), item0 (3), item1 (4), item2 (5) → crash.
    let calls = 0;
    await expect(
      runProposalExecution(deps, {
        workspaceId: ws(),
        proposalId: row.id,
        run: (fn) => {
          calls++;
          if (calls === 5) throw new Error('crash');
          return withWorkspace(ws(), fn);
        },
      }),
    ).rejects.toThrow('crash');
    expect((await load(row.id)).items.filter((i) => i.status === 'done')).toHaveLength(2);
    await getDb()
      .update(schema.copilotActionProposals)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.copilotActionProposals.id, row.id));

    const sweep = await sweepProposalsOnce(deps, fakeSweepRedis(), { awaitResumes: true });
    expect(sweep.resumed).toBeGreaterThanOrEqual(1);
    expect((await load(row.id)).proposal.status).toBe('completed');
    for (const id of ids) expect(store.countExecutions(id)).toBe(1);
  });

  it('executor que lança → item failed com código estável; nenhum done → failed', async () => {
    const ids = newIds(1);
    const row = persistedRow(
      await propose('OWNER', 'deal.move', { ids: [...ids, ...newIds(1)], to: 'R' }),
    );
    store.onExecute = () => {
      throw Object.assign(new Error('regra'), { code: 'transition_rule' });
    };
    const { final } = await confirmAndRun('OWNER', row);
    expect(final?.status).toBe('failed');
    const { items } = await load(row.id);
    expect(items.every((i) => i.status === 'failed' && i.errorCode === 'transition_rule')).toBe(
      true,
    );
  });
});

describe('desfazer', () => {
  it('um item alterado depois → partially_undone (undo_conflict nele)', async () => {
    const ids = newIds(2);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    await confirmAndRun('OWNER', row);
    store.touch(ids[0]!, 'Paula', 'Outro estágio');
    const out = await undo('OWNER', row.id);
    expect(out.ok && out.row.status).toBe('partially_undone');
    const { items } = await load(row.id);
    expect(items.find((i) => i.targetId === ids[0])?.status).toBe('undo_conflict');
    expect(items.find((i) => i.targetId === ids[1])?.status).toBe('undone');
    // Ordem inversa.
    expect(store.undoCalls).toEqual([ids[1], ids[0]]);
  });

  it('depois da janela → undo_window_closed (410)', async () => {
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids: newIds(1), to: 'R' }));
    await getDb()
      .update(schema.copilotActionProposals)
      .set({ undoDeadline: new Date(Date.now() - 1000) })
      .where(eq(schema.copilotActionProposals.id, row.id));
    const out = await undo('OWNER', row.id);
    expect(!out.ok && out.error).toBe('undo_window_closed');
  });

  it('quem não é dono nem gestor não desfaz; gestor desfaz com a permissão dele', async () => {
    const row = persistedRow(await propose('AGENT', 'deal.move', { ids: newIds(1), to: 'R' }));
    expect(row.status).toBe('completed');
    const other = await withWorkspace(ws(), (tx) => principalIn(tx, 'READONLY'));
    const denied = await undoProposal(deps, other, row.id, randomUUID());
    expect(!denied.ok && denied.error).toBe('not_found');
    const byManager = await undo('SUPERVISOR', row.id);
    expect(byManager.ok && byManager.row.undoneBy).toBe(memberId('SUPERVISOR'));
  });
});

describe('tentar de novo', () => {
  it('cria proposta NOVA só com os itens que falharam, com versão nova', async () => {
    const ids = newIds(3);
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids, to: 'R' }));
    store.touch(ids[2]!, 'Paula');
    await confirmAndRun('OWNER', row);
    const retried = await withWorkspace(ws(), async (tx) =>
      retryFailedItems(deps, tx, await principalIn(tx, 'OWNER'), row.id),
    );
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.proposal.id).not.toBe(row.id);
    expect(retried.proposal.status).toBe('proposed');
    expect(retried.proposal.items.data.map((i) => i.target_id)).toEqual([ids[2]]);
    const fresh = await load(retried.proposal.id);
    expect(fresh.items[0]?.expectedVersion).toBe('2');
    expect((await load(row.id)).proposal.status).toBe('partially_completed');
  });
});

describe('aprovação', () => {
  it('só aprovador elegível; executa com as permissões dele; trilha com requested_by', async () => {
    const ids = newIds(1);
    const outcome = await propose('AGENT', 'campaign.pause', { ids, to: 'Pausada' });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('role');
    expect(outcome.canRequestApproval).toBe(true);
    const row = outcome.row;

    const approvers = await withWorkspace(ws(), async (tx) =>
      listApprovers(tx, await principalIn(tx, 'AGENT'), 'campaign.pause', 1),
    );
    expect(approvers.map((a) => a.role)).toEqual(['OWNER', 'ADMIN', 'SUPERVISOR']);

    const ask = (approver: Role) =>
      withWorkspace(ws(), async (tx) =>
        requestApproval(deps, tx, await principalIn(tx, 'AGENT'), row.id, memberId(approver)),
      );
    const bad = await ask('READONLY');
    expect(!bad.ok && bad.error).toBe('invalid_approver');
    const ok = await ask('SUPERVISOR');
    expect(ok.ok && ok.row.status).toBe('awaiting_approval');
    if (!ok.ok) return;
    const hours = (ok.row.expiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(ok.notification).toMatchObject({
      memberId: memberId('SUPERVISOR'),
      evento: 'copilot_aprovacao',
    });

    // Nem o solicitante nem outro gestor confirmam: só o aprovador escolhido.
    const byAgent = await confirm('AGENT', row.id, { version: ok.row.version, acknowledged: true });
    expect(!byAgent.ok && byAgent.error).toBe('forbidden');
    const byAdmin = await confirm('ADMIN', row.id, { version: ok.row.version, acknowledged: true });
    expect(!byAdmin.ok && byAdmin.error).toBe('forbidden');

    const approved = await confirm('SUPERVISOR', row.id, {
      version: ok.row.version,
      acknowledged: true,
    });
    expect(approved.ok && approved.status).toBe(202);
    if (!approved.ok) return;
    expect(approved.notification).toMatchObject({ memberId: memberId('AGENT') });
    const final = approved.start ? await approved.start() : null;
    expect(final?.status).toBe('completed');
    expect(final?.executedAsMemberId).toBe(memberId('SUPERVISOR'));
    expect(final?.requestedByMemberId).toBe(memberId('AGENT'));

    const audit = await auditRows(row.id);
    expect(audit.map((a) => a.action)).toEqual([
      'copilot.proposal.blocked',
      'copilot.proposal.awaiting_approval',
      'copilot.proposal.executing',
      'copilot.proposal.completed',
    ]);
    const exec = audit[2];
    expect(exec?.actor).toBe(memberId('SUPERVISOR'));
    expect(exec?.requestedBy).toBe(memberId('AGENT'));
  });

  it('o aprovador recusa (cancelar) → cancelled e o solicitante é avisado', async () => {
    const outcome = await propose('AGENT', 'campaign.pause', { ids: newIds(1), to: 'P' });
    const row = persistedRow(outcome);
    const asked = await withWorkspace(ws(), async (tx) =>
      requestApproval(deps, tx, await principalIn(tx, 'AGENT'), row.id, memberId('ADMIN')),
    );
    expect(asked.ok).toBe(true);
    const rejected = await withWorkspace(ws(), async (tx) =>
      cancelProposal(deps, tx, await principalIn(tx, 'ADMIN'), row.id),
    );
    expect(rejected.ok && rejected.row.status).toBe('cancelled');
    expect(rejected.ok && rejected.notification).toMatchObject({
      memberId: memberId('AGENT'),
      titulo: 'Seu pedido foi recusado',
    });
  });
});

describe('contaminação do turno (P4)', () => {
  it('turno contaminado (lido do banco) eleva o nível 2 para 3: não executa sem clique', async () => {
    const secret = Buffer.alloc(32, 9);
    const turn = await seedCopilotTurn({ workspaceId: ws(), memberId: memberId('OWNER'), secret });
    await withWorkspace(ws(), (tx) => copilotTurnsRepo.markTainted(tx, turn.turnId));
    const [id] = newIds(1);
    const outcome = await propose(
      'OWNER',
      'deal.move',
      { ids: [id!], to: 'Perdido' },
      // O chamador diz "não contaminado"; o banco vence.
      { turnId: turn.turnId, sessionId: turn.sessionId, turnTainted: false },
    );
    expect(outcome.kind).toBe('proposed');
    const row = persistedRow(outcome);
    expect(row.riskLevel).toBe(3);
    expect(row.turnId).toBe(turn.turnId);
    expect(store.executeCalls).toHaveLength(0);
    const audit = await auditRows(row.id);
    expect(audit[0]?.metadata).toMatchObject({ tainted: true });
  });
});

describe('escopo', () => {
  it('nenhum alvo visível → blocked por scope, sem itens; os invisíveis são informados', async () => {
    const [id] = newIds(1);
    store.records.get(id!)!.hidden = true;
    const outcome = await propose('OWNER', 'deal.move', { ids: [id!, randomUUID()], to: 'R' });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('scope');
    expect(outcome.dropped).toHaveLength(2);
    expect(outcome.items).toHaveLength(0);
    const envelope = proposeEnvelope(outcome);
    expect(envelope.decision).toBe('blocked');
    expect(envelope.public_event?.type).toBe('action_blocked');
  });

  it('acima de 200 alvos → recusa (use a tela), nada gravado', async () => {
    const outcome = await propose('OWNER', 'deal.move', { ids: newIds(201), to: 'R' });
    expect(outcome.kind).toBe('batch_too_large');
    const env = proposeEnvelope(outcome);
    expect(env.decision).toBe('invalid_args');
    const rows = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.copilotActionProposals)
      .where(
        and(
          eq(schema.copilotActionProposals.workspaceId, ws()),
          eq(schema.copilotActionProposals.summary, 'Mover 201 registros para R'),
        ),
      );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('execução em segundo plano', () => {
  it('startProposalExecution é rastreada e drenável', async () => {
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids: newIds(2), to: 'R' }));
    const out = await confirm('OWNER', row.id, { version: row.version });
    expect(out.ok).toBe(true);
    void startProposalExecution(deps, { workspaceId: ws(), proposalId: row.id });
    await drainProposalExecutions();
    expect((await load(row.id)).proposal.status).toBe('completed');
  });
});

describe('varredura ligada (startProposalSweeper)', () => {
  it('roda no intervalo com lock, expira, e para no stop() sem novos ticks', async () => {
    const row = persistedRow(await propose('OWNER', 'deal.move', { ids: newIds(2), to: 'R' }));
    await getDb()
      .update(schema.copilotActionProposals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.copilotActionProposals.id, row.id));
    const redis = fakeSweepRedis();
    let ticks = 0;
    const counting = {
      set: async (...a: Parameters<typeof redis.set>) => {
        ticks++;
        return redis.set(...a);
      },
      eval: redis.eval,
    };
    const sweeper = startProposalSweeper(deps, { intervalMs: 20, redis: counting });
    const deadline = Date.now() + 5000;
    while ((await load(row.id)).proposal.status !== 'expired' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    await sweeper.stop();
    expect((await load(row.id)).proposal.status).toBe('expired');
    // O lock foi liberado a cada passada (o próximo tick pega de novo).
    expect(redis.store.size).toBe(0);
    const after = ticks;
    await new Promise((r) => setTimeout(r, 80));
    expect(ticks).toBe(after);
  });
});
