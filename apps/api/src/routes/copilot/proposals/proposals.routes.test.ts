/**
 * F73-S05 — API pública de propostas sobre o Postgres e o Redis de dev, com a MESMA porta de
 * produção (`requireAuth → withRLS → copilotAvailable`) e executores FAKE.
 *
 * Códigos estáveis do contrato: 200/201/202, 400, 402 (só leitura, sem exceção), 403, 404 (sem
 * oráculo), 409, 410, 422 e 429 (30/min por membro em confirmar/desfazer/ajustar).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace, type CopilotProposalRow } from '@hm/db';
import { ApproverSchema, ProposalDTOSchema, type Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../../middlewares/auth';
import { closeRateLimit } from '../../../middlewares/rate-limit';
import { copilotAvailable } from '../../../services/copilot/identity/available';
import { resolveCopilotPrincipal } from '../../../services/copilot/identity/principal';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import { drainProposalExecutions, proposeAction } from '../../../services/copilot/proposals';
import {
  FakeStore,
  makeTestDeps,
  type FakeArgs,
  type TestDeps,
} from '../../../services/copilot/proposals/test-fixtures';
import { createCopilotRouter } from '../index';
import { createCopilotProposalsRouter, PROPOSAL_WRITE_RATE_LIMIT } from './index';

let seeded: SeededWorkspace;
let store: FakeStore;
let deps: TestDeps;
let app: Express;

function buildApp(d: TestDeps): Express {
  const a = express();
  a.use(express.json());
  const router = Router();
  router.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
  router.use(createCopilotProposalsRouter({ deps: d }));
  a.use(router);
  return a;
}

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'ProposalsApi' });
});

afterAll(async () => {
  await drainProposalExecutions();
  await seeded?.cleanup();
  await closeRateLimit();
  await closeDb();
});

beforeEach(() => {
  store = new FakeStore();
  deps = makeTestDeps(store);
  app = buildApp(deps);
});

const cookie = (role: Role): string => seeded.members[role].cookie;
const memberId = (role: Role): string => seeded.members[role].id;

function ids(n: number): string[] {
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
): Promise<CopilotProposalRow> {
  const executor = deps.executors.get(capability)!;
  const outcome = await withWorkspace(seeded.workspaceId, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: seeded.workspaceId,
      memberId: memberId(role),
    });
    return proposeAction(
      deps,
      { tx, principal: principal!, source: 'copilot', turnId: null, sessionId: null },
      executor,
      args,
    );
  });
  if (!('row' in outcome)) throw new Error(outcome.kind);
  return outcome.row;
}

const confirmReq = (role: Role, id: string, body: object, key: string | null = randomUUID()) => {
  const r = request(app).post(`/api/copilot/proposals/${id}/confirm`).set('Cookie', cookie(role));
  return (key ? r.set('Idempotency-Key', key) : r).send(body);
};

describe('GET /api/copilot/proposals/:id', () => {
  it('dono lê o DTO do contrato com can_confirm; outro atendente recebe 404 (sem oráculo)', async () => {
    const row = await propose('AGENT', 'deal.move', { ids: ids(2), to: 'R' });
    const res = await request(app)
      .get(`/api/copilot/proposals/${row.id}`)
      .set('Cookie', cookie('AGENT'));
    expect(res.status).toBe(200);
    const dto = ProposalDTOSchema.parse(res.body);
    expect(dto).toMatchObject({ status: 'proposed', risk_level: 3, can_confirm: true });
    expect(dto.items.data).toHaveLength(2);

    // READONLY não é dono nem gestor: 404, igual a um id que não existe.
    const other = await request(app)
      .get(`/api/copilot/proposals/${row.id}`)
      .set('Cookie', cookie('READONLY'));
    const missing = await request(app)
      .get(`/api/copilot/proposals/${randomUUID()}`)
      .set('Cookie', cookie('READONLY'));
    expect([other.status, missing.status]).toEqual([404, 404]);
    expect(other.body).toEqual(missing.body);

    // Gestor vê, mas não confirma o que não é dele.
    const manager = await request(app)
      .get(`/api/copilot/proposals/${row.id}`)
      .set('Cookie', cookie('SUPERVISOR'));
    expect(manager.status).toBe(200);
    expect(manager.body.can_confirm).toBe(false);
  });

  it('id malformado → 404; sem sessão → 401', async () => {
    const bad = await request(app)
      .get('/api/copilot/proposals/nada')
      .set('Cookie', cookie('OWNER'));
    expect(bad.status).toBe(404);
    expect((await request(app).get(`/api/copilot/proposals/${randomUUID()}`)).status).toBe(401);
  });

  it('o router real (`createCopilotRouter`) monta as rotas da S05', async () => {
    const real = express();
    real.use(express.json());
    real.use(createCopilotRouter());
    const res = await request(real)
      .get(`/api/copilot/proposals/${randomUUID()}`)
      .set('Cookie', cookie('OWNER'));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('POST /api/copilot/proposals/:id/confirm', () => {
  it('202 executando; replay com a mesma chave 200; outra chave 409 already_confirmed', async () => {
    const targets = ids(2);
    const row = await propose('OWNER', 'deal.move', { ids: targets, to: 'R' });
    const key = randomUUID();
    const first = await confirmReq('OWNER', row.id, { version: row.version }, key);
    expect(first.status).toBe(202);
    expect(ProposalDTOSchema.parse(first.body).status).toBe('executing');
    await drainProposalExecutions();
    const replay = await confirmReq('OWNER', row.id, { version: row.version }, key);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('completed');
    const other = await confirmReq('OWNER', row.id, { version: row.version });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('already_confirmed');
    for (const t of targets) expect(store.countExecutions(t)).toBe(1);
    // Progresso emitido às salas do dono.
    expect(deps.emitted.some((e) => e.memberIds.includes(memberId('OWNER')))).toBe(true);
  });

  it('sem Idempotency-Key → 400; corpo inválido → 400', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(2), to: 'R' });
    expect((await confirmReq('OWNER', row.id, { version: row.version }, null)).status).toBe(400);
    const bad = await confirmReq('OWNER', row.id, { version: 'x' });
    expect(bad.status).toBe(400);
  });

  it('versão divergente → 409 stale_proposal com a proposta atual', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(2), to: 'R' });
    const res = await confirmReq('OWNER', row.id, { version: row.version + 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stale_proposal');
    expect(ProposalDTOSchema.parse(res.body.proposal).version).toBe(row.version);
  });

  it('nível 4 sem "Revisei" → 422 ack_required', async () => {
    const row = await propose('OWNER', 'campaign.pause', { ids: ids(1), to: 'P' });
    const res = await confirmReq('OWNER', row.id, { version: row.version });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('ack_required');
  });

  it('expirada → 410 proposal_expired', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(2), to: 'R' });
    await getDb()
      .update(schema.copilotActionProposals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.copilotActionProposals.id, row.id));
    const res = await confirmReq('OWNER', row.id, { version: row.version });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('proposal_expired');
  });

  it('papel rebaixado entre propor e confirmar → 403', async () => {
    const row = await propose('AGENT', 'deal.move', { ids: ids(2), to: 'R' });
    await getDb()
      .update(schema.members)
      .set({ role: 'READONLY' })
      .where(eq(schema.members.id, memberId('AGENT')));
    try {
      const res = await confirmReq('AGENT', row.id, { version: row.version });
      expect(res.status).toBe(403);
    } finally {
      await getDb()
        .update(schema.members)
        .set({ role: 'AGENT' })
        .where(eq(schema.members.id, memberId('AGENT')));
    }
  });

  it('assinatura expirada → 402 (guard de assinatura, sem exceção para o confirmar)', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(2), to: 'R' });
    await getDb()
      .update(schema.workspaces)
      .set({ subscriptionStatus: 'expired' })
      .where(eq(schema.workspaces.id, seeded.workspaceId));
    try {
      const res = await confirmReq('OWNER', row.id, { version: row.version });
      expect(res.status).toBe(402);
      // Ler continua: GET segue 200 em só leitura.
      const read = await request(app)
        .get(`/api/copilot/proposals/${row.id}`)
        .set('Cookie', cookie('OWNER'));
      expect(read.status).toBe(200);
      expect(read.body.can_confirm).toBe(false);
    } finally {
      await getDb()
        .update(schema.workspaces)
        .set({ subscriptionStatus: 'active' })
        .where(eq(schema.workspaces.id, seeded.workspaceId));
    }
  });
});

describe('adjust, cancel, undo, retry', () => {
  it('ajustar exclui item e troca parâmetro declarado: 200, version+1, prévia nova', async () => {
    const targets = ids(3);
    const row = await propose('OWNER', 'deal.move', { ids: targets, to: 'R' });
    const before = await request(app)
      .get(`/api/copilot/proposals/${row.id}`)
      .set('Cookie', cookie('OWNER'));
    const itemId: string = before.body.items.data[0].id;
    const stage = randomUUID();
    const res = await request(app)
      .post(`/api/copilot/proposals/${row.id}/adjust`)
      .set('Cookie', cookie('OWNER'))
      .send({
        version: row.version,
        exclude_item_ids: [itemId],
        params: { target_stage_id: stage },
      });
    expect(res.status).toBe(200);
    const dto = ProposalDTOSchema.parse(res.body);
    expect(dto.version).toBe(row.version + 1);
    expect(dto.items.data.find((i) => i.id === itemId)?.status).toBe('excluded');
    expect(dto.summary).toContain(stage.slice(0, 8));
    expect(dto.progress.total).toBe(2);
    // Confirmar a prévia antiga agora é 409.
    const stale = await confirmReq('OWNER', row.id, { version: row.version });
    expect(stale.status).toBe(409);
  });

  it('ajuste inválido → 422 (item de fora, parâmetro não declarado)', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(2), to: 'R' });
    const foreign = await request(app)
      .post(`/api/copilot/proposals/${row.id}/adjust`)
      .set('Cookie', cookie('OWNER'))
      .send({ version: row.version, exclude_item_ids: [randomUUID()] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error).toBe('invalid_adjustment');
    const undeclared = await request(app)
      .post(`/api/copilot/proposals/${row.id}/adjust`)
      .set('Cookie', cookie('OWNER'))
      .send({ version: row.version, params: { pause_instead: true } });
    expect(undeclared.status).toBe(422);
  });

  it('cancelar antes de executar → 200 cancelled; confirmar depois → 409', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(2), to: 'R' });
    const res = await request(app)
      .post(`/api/copilot/proposals/${row.id}/cancel`)
      .set('Cookie', cookie('OWNER'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const late = await confirmReq('OWNER', row.id, { version: res.body.version });
    expect(late.status).toBe(409);
  });

  it('desfazer: 200; de novo com outra chave 409 not_undoable; fora da janela 410', async () => {
    const row = await propose('OWNER', 'deal.move', { ids: ids(1), to: 'R' });
    expect(row.status).toBe('completed');
    const res = await request(app)
      .post(`/api/copilot/proposals/${row.id}/undo`)
      .set('Cookie', cookie('OWNER'))
      .set('Idempotency-Key', randomUUID());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('undone');
    const again = await request(app)
      .post(`/api/copilot/proposals/${row.id}/undo`)
      .set('Cookie', cookie('OWNER'))
      .set('Idempotency-Key', randomUUID());
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('not_undoable');

    const late = await propose('OWNER', 'deal.move', { ids: ids(1), to: 'R' });
    await getDb()
      .update(schema.copilotActionProposals)
      .set({ undoDeadline: new Date(Date.now() - 1000) })
      .where(eq(schema.copilotActionProposals.id, late.id));
    const closed = await request(app)
      .post(`/api/copilot/proposals/${late.id}/undo`)
      .set('Cookie', cookie('OWNER'))
      .set('Idempotency-Key', randomUUID());
    expect(closed.status).toBe(410);
    expect(closed.body.error).toBe('undo_window_closed');
  });

  it('tentar de novo → 201 com proposta nova', async () => {
    const targets = ids(2);
    const row = await propose('OWNER', 'deal.move', { ids: targets, to: 'R' });
    store.touch(targets[0]!, 'Paula');
    await confirmReq('OWNER', row.id, { version: row.version });
    await drainProposalExecutions();
    const res = await request(app)
      .post(`/api/copilot/proposals/${row.id}/retry-failed`)
      .set('Cookie', cookie('OWNER'));
    expect(res.status).toBe(201);
    const dto = ProposalDTOSchema.parse(res.body);
    expect(dto.id).not.toBe(row.id);
    expect(dto.items.data.map((i) => i.target_id)).toEqual([targets[0]]);
    const none = await request(app)
      .post(`/api/copilot/proposals/${dto.id}/retry-failed`)
      .set('Cookie', cookie('OWNER'));
    expect(none.status).toBe(409);
  });
});

describe('aprovação', () => {
  it('aprovadores calculados no servidor; pedir a quem não pode → 422; ao gestor → 200', async () => {
    const list = await request(app)
      .get('/api/copilot/approvers?capability=campaign.pause')
      .set('Cookie', cookie('AGENT'));
    expect(list.status).toBe(200);
    const approvers = (list.body.data as unknown[]).map((a) => ApproverSchema.parse(a));
    expect(approvers.map((a) => a.role)).toEqual(['OWNER', 'ADMIN', 'SUPERVISOR']);
    const badQuery = await request(app)
      .get('/api/copilot/approvers?capability=query')
      .set('Cookie', cookie('AGENT'));
    expect(badQuery.status).toBe(400);

    const row = await propose('AGENT', 'campaign.pause', { ids: ids(1), to: 'P' });
    expect(row.status).toBe('blocked');
    const bad = await request(app)
      .post(`/api/copilot/proposals/${row.id}/request-approval`)
      .set('Cookie', cookie('AGENT'))
      .send({ approver_member_id: memberId('READONLY') });
    expect(bad.status).toBe(422);
    const ok = await request(app)
      .post(`/api/copilot/proposals/${row.id}/request-approval`)
      .set('Cookie', cookie('AGENT'))
      .send({ approver_member_id: memberId('SUPERVISOR') });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('awaiting_approval');
    expect(ok.body.approver.member_id).toBe(memberId('SUPERVISOR'));
    expect(deps.notified.at(-1)).toMatchObject({
      memberId: memberId('SUPERVISOR'),
      evento: 'copilot_aprovacao',
    });

    // O aprovador vê can_confirm; confirma com as permissões dele.
    const view = await request(app)
      .get(`/api/copilot/proposals/${row.id}`)
      .set('Cookie', cookie('SUPERVISOR'));
    expect(view.body.can_confirm).toBe(true);
    const confirmed = await confirmReq('SUPERVISOR', row.id, {
      version: ok.body.version,
      acknowledged: true,
    });
    expect(confirmed.status).toBe(202);
    await drainProposalExecutions();
    expect(deps.notified.at(-1)).toMatchObject({ memberId: memberId('AGENT') });
  });
});

describe('rate limit', () => {
  it(`confirmar/desfazer/ajustar: ${PROPOSAL_WRITE_RATE_LIMIT.max}/min por membro → 429`, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < PROPOSAL_WRITE_RATE_LIMIT.max + 1; i++) {
      const res = await confirmReq('ADMIN', randomUUID(), { version: 1 });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, PROPOSAL_WRITE_RATE_LIMIT.max).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // O limite é por membro: outro membro segue livre.
    const other = await confirmReq('SUPERVISOR', randomUUID(), { version: 1 });
    expect(other.status).toBe(404);
  });
});
