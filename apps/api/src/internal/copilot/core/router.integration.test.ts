/**
 * F73-S03 — callback interno do Copiloto contra o Postgres de dev (ADR-003 §3).
 *
 * Cada recusa prova que o handler NÃO rodou (contador) e, depois do `claimToolCall`, que a
 * chamada ficou em `copilot_tool_calls` com `args_redacted` sem PII.
 *
 * Escritas passam pelo motor de propostas (`makeProposeTool`, executores FAKE da F73-S05): o
 * callback só confere a porta (turno, grant, membro ativo, Copiloto ligado, `requires`,
 * orçamento `paused`); papel, matriz, assinatura e `queries_only` viram proposta `blocked`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  closeDb,
  copilotProposalsRepo,
  copilotToolCallsRepo,
  copilotTurnsRepo,
  getDb,
  schema,
  withWorkspace,
} from '@hm/db';
import { createLogger, type LogFields, type Logger } from '@hm/logger';
import { mintGrant } from '../../../services/copilot/identity/grant';
import {
  seedCopilotTurn,
  seedCopilotWorkspace,
  type SeededTurn,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import { makeProposeTool } from '../../../services/copilot/proposals';
import { FakeStore, makeTestDeps } from '../../../services/copilot/proposals/test-fixtures';
import { defineCopilotTool, loadToolOfferContext, type CopilotToolDefinition } from './registry';
import { COPILOT_MODEL_VIEWS, createCopilotToolsRouter } from './router';

const TOKEN = `test-${randomUUID()}`;
const SECRET = randomBytes(32);
const calls = { query: 0, taint: 0, boom: 0, effects: 0 };

// Motor de propostas com executores FAKE (sem domínio): a escrita real do callback.
const store = new FakeStore();
const deps = makeTestDeps(store);
const writes = {
  get count(): number {
    return store.executeCalls.length;
  },
};
const moveTool = makeProposeTool(deps.executors.get('deal.move')!, {
  key: 'test_write',
  description: 'Mover negócios (teste).',
  deps: () => deps,
});
const pauseTool = makeProposeTool(deps.executors.get('campaign.pause')!, {
  description: 'Pausar campanha (teste).',
  deps: () => deps,
});
/** Um alvo novo e visível no registro fake. */
function deal(): string {
  const id = randomUUID();
  store.add(id);
  return id;
}

const tools: CopilotToolDefinition[] = [
  defineCopilotTool({
    key: 'test_query',
    capability: 'query',
    area: 'pipeline',
    description: 'Consulta de teste.',
    args: z
      .object({
        q: z.string().max(200).optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      })
      .strict(),
    requires: ['pipeline.view'],
    taintsTurn: false,
    async handler(ctx) {
      calls.query++;
      const emitted = ctx.emitResult({
        kind: 'kpis',
        source: { label: 'Pipeline', as_of: new Date().toISOString(), record_count: 1 },
        truncated: false,
        data: {
          currency: null,
          items: [
            {
              key: 'open',
              label: 'Em aberto',
              value: 1,
              format: 'number',
              delta: null,
              range: null,
            },
          ],
          why: [],
        },
      });
      return { ok: true, decision: 'executed', model_view: { open: 1 }, ...emitted };
    },
  }),
  moveTool,
  pauseTool,
  defineCopilotTool({
    key: 'test_effects',
    capability: 'query',
    area: 'pipeline',
    description: 'Agenda um efeito pós-commit e devolve um envelope válido ou inválido.',
    args: z.object({ broken: z.boolean() }).strict(),
    taintsTurn: false,
    async handler(ctx, args) {
      ctx.afterCommit(() => {
        calls.effects++;
      });
      return args.broken
        ? ({ ok: 'talvez' } as unknown as { ok: true; decision: 'executed'; model_view: string })
        : { ok: true, decision: 'executed', model_view: 'ok' };
    },
  }),
  defineCopilotTool({
    key: 'test_taint',
    capability: 'query',
    area: 'conversations',
    description: 'Lê mensagem de contato.',
    args: z.object({}).strict(),
    taintsTurn: true,
    async handler() {
      calls.taint++;
      return { ok: true, decision: 'executed', model_view: { untrusted: 'texto do cliente' } };
    },
  }),
  defineCopilotTool({
    key: 'test_boom',
    capability: 'query',
    description: 'Falha.',
    args: z.object({}).strict(),
    taintsTurn: false,
    async handler() {
      calls.boom++;
      throw new Error('falha com dado sensível: maria@example.com');
    },
  }),
];

let seeded: SeededWorkspace;
let other: SeededWorkspace;
let app: Express;

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use(
    createCopilotToolsRouter({
      tools,
      token: TOKEN,
      grantSecret: SECRET,
      logger: createLogger('error', { svc: 'test' }),
    }),
  );
  return a;
}

function call(
  key: string,
  turn: Pick<SeededTurn, 'turnId' | 'grant'>,
  args: Record<string, unknown> = {},
) {
  return request(app)
    .post(`/internal/copilot/tools/${key}`)
    .set('Authorization', `Bearer ${TOKEN}`)
    .set('X-Copilot-Grant', turn.grant)
    .send({ turn_id: turn.turnId, call_id: `call_${randomUUID().slice(0, 8)}`, args });
}

async function turnFor(
  role: 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'READONLY',
  over: { maxToolCalls?: number } = {},
): Promise<SeededTurn> {
  return seedCopilotTurn({
    workspaceId: seeded.workspaceId,
    memberId: seeded.members[role].id,
    secret: SECRET,
    ...over,
  });
}

async function logsOf(turnId: string) {
  return withWorkspace(seeded.workspaceId, (tx) =>
    tx
      .select()
      .from(schema.copilotToolCalls)
      .where(eq(schema.copilotToolCalls.turnId, turnId))
      .orderBy(desc(schema.copilotToolCalls.createdAt)),
  );
}

async function setSubscription(status: string): Promise<void> {
  await getDb()
    .update(schema.workspaces)
    .set({ subscriptionStatus: status })
    .where(eq(schema.workspaces.id, seeded.workspaceId));
}

const snapshot = () => ({ ...calls });

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Callback' });
  other = await seedCopilotWorkspace({ label: 'Callback other' });
  app = buildApp();
});

afterAll(async () => {
  await seeded?.cleanup();
  await other?.cleanup();
  await closeDb();
});

beforeEach(async () => {
  await setSubscription('active');
});

describe('recusas antes do turno (nada executa, nada é consumido)', () => {
  it('sem bearer → 401', async () => {
    const turn = await turnFor('OWNER');
    const before = snapshot();
    const res = await request(app)
      .post('/internal/copilot/tools/test_query')
      .set('X-Copilot-Grant', turn.grant)
      .send({ turn_id: turn.turnId, call_id: 'c1', args: {} });
    expect(res.status).toBe(401);
    expect(snapshot()).toEqual(before);
    expect(await logsOf(turn.turnId)).toHaveLength(0);
  });

  it('bearer errado → 401', async () => {
    const turn = await turnFor('OWNER');
    const res = await request(app)
      .post('/internal/copilot/tools/test_query')
      .set('Authorization', 'Bearer outro')
      .set('X-Copilot-Grant', turn.grant)
      .send({ turn_id: turn.turnId, call_id: 'c1', args: {} });
    expect(res.status).toBe(401);
  });

  it('sem grant, grant adulterado, grant expirado → 401 com motivo estável', async () => {
    const turn = await turnFor('OWNER');
    const missing = await call('test_query', { turnId: turn.turnId, grant: '' });
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'grant_malformed' });

    const [p = '', s = ''] = turn.grant.split('.');
    const tampered = await call('test_query', {
      turnId: turn.turnId,
      grant: `${p}.${s.slice(1)}A`,
    });
    expect(tampered.body.error).toBe('grant_bad_signature');

    const expired = mintGrant(
      {
        turnId: turn.turnId,
        workspaceId: seeded.workspaceId,
        memberId: seeded.members.OWNER.id,
        nonce: turn.nonce,
      },
      { secret: SECRET, now: new Date(Date.now() - 10 * 60_000) },
    );
    const exp = await call('test_query', { turnId: turn.turnId, grant: expired });
    expect(exp.body.error).toBe('grant_expired');

    const wrongSecret = mintGrant(
      {
        turnId: turn.turnId,
        workspaceId: seeded.workspaceId,
        memberId: seeded.members.OWNER.id,
        nonce: turn.nonce,
      },
      { secret: randomBytes(32) },
    );
    expect((await call('test_query', { turnId: turn.turnId, grant: wrongSecret })).body.error).toBe(
      'grant_bad_signature',
    );
  });

  it('grant de OUTRO workspace (assinatura válida) → 403 turn_not_active', async () => {
    const turn = await turnFor('OWNER');
    const before = snapshot();
    const crossTenant = mintGrant(
      {
        turnId: turn.turnId,
        workspaceId: other.workspaceId,
        memberId: seeded.members.OWNER.id,
        nonce: turn.nonce,
      },
      { secret: SECRET },
    );
    const res = await call('test_query', { turnId: turn.turnId, grant: crossTenant });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ ok: false, error: 'turn_not_active' });
    expect(snapshot()).toEqual(before);
  });

  it('turno de OUTRO membro (grant do colega para o meu turno) → 403', async () => {
    const turn = await turnFor('OWNER');
    const before = snapshot();
    const stolen = mintGrant(
      {
        turnId: turn.turnId,
        workspaceId: seeded.workspaceId,
        memberId: seeded.members.AGENT.id,
        nonce: turn.nonce,
      },
      { secret: SECRET },
    );
    const res = await call('test_query', { turnId: turn.turnId, grant: stolen });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('turn_not_active');
    expect(snapshot()).toEqual(before);
  });

  it('nonce errado → 403', async () => {
    const turn = await turnFor('OWNER');
    const wrongNonce = mintGrant(
      {
        turnId: turn.turnId,
        workspaceId: seeded.workspaceId,
        memberId: seeded.members.OWNER.id,
        nonce: 'x'.repeat(32),
      },
      { secret: SECRET },
    );
    expect((await call('test_query', { turnId: turn.turnId, grant: wrongNonce })).status).toBe(403);
  });

  it('turno completed → 403 turn_not_active', async () => {
    const turn = await turnFor('OWNER');
    await withWorkspace(seeded.workspaceId, (tx) =>
      copilotTurnsRepo.complete(tx, turn.turnId, {
        promptTokens: 1,
        completionTokens: 1,
        costUsd: '0',
        iterations: 1,
      }),
    );
    const before = snapshot();
    const res = await call('test_query', turn);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('turn_not_active');
    expect(snapshot()).toEqual(before);
  });

  it('tool_calls esgotado → 403 na chamada seguinte, sem executar', async () => {
    const turn = await turnFor('OWNER', { maxToolCalls: 1 });
    expect((await call('test_query', turn)).status).toBe(200);
    const before = snapshot();
    const res = await call('test_query', turn);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('turn_not_active');
    expect(snapshot()).toEqual(before);
  });

  it('corpo fora do contrato ou turn_id diferente do grant → recusa sem consumir', async () => {
    const turn = await turnFor('OWNER', { maxToolCalls: 1 });
    const bad = await request(app)
      .post('/internal/copilot/tools/test_query')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Copilot-Grant', turn.grant)
      .send({ turn_id: turn.turnId, call_id: 'c', args: {}, member_id: randomUUID() });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_body');
    const mismatch = await call('test_query', { turnId: randomUUID(), grant: turn.grant });
    expect(mismatch.status).toBe(403);
    // O teto de 1 continua disponível: nenhuma das recusas acima consumiu a chamada.
    expect((await call('test_query', turn)).status).toBe(200);
  });
});

describe('falha do banco ao consumir a chamada (passo 4)', () => {
  it('claimToolCall lança → envelope de erro seguro; log só com código/constraint', async () => {
    const errors: { msg: string; fields: LogFields | undefined }[] = [];
    const noop = (): void => undefined;
    const captured: Logger = {
      debug: noop,
      info: noop,
      warn: noop,
      error: (msg, fields) => {
        errors.push({ msg, fields });
      },
      child: () => captured,
    };
    const local = express();
    local.use(express.json());
    local.use(
      createCopilotToolsRouter({ tools, token: TOKEN, grantSecret: SECRET, logger: captured }),
    );
    const turn = await turnFor('OWNER');
    const sensitive = `Failed query: update copilot_turns params: ${turn.nonce},maria@example.com`;
    const spy = vi.spyOn(copilotTurnsRepo, 'claimToolCall').mockRejectedValueOnce(
      new Error(sensitive, {
        cause: Object.assign(new Error('pg'), { code: '40001', constraint_name: 'ck_x' }),
      }),
    );
    const before = snapshot();
    try {
      const res = await request(local)
        .post('/internal/copilot/tools/test_query')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Copilot-Grant', turn.grant)
        .send({ turn_id: turn.turnId, call_id: 'c1', args: {} });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: false,
        decision: 'error',
        model_view: COPILOT_MODEL_VIEWS.error,
      });
      expect(JSON.stringify(res.body)).not.toContain(turn.nonce);
    } finally {
      spy.mockRestore();
    }
    expect(snapshot()).toEqual(before);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.fields).toMatchObject({
      code: '40001',
      constraint: 'ck_x',
      errorName: 'Error',
    });
    const logged = JSON.stringify(errors);
    expect(logged).not.toContain(turn.nonce);
    expect(logged).not.toContain('maria@example.com');
    expect(logged).not.toContain('Failed query');
  });
});

describe('depois do turno: reautoriza do zero a cada chamada', () => {
  it('executa a consulta, devolve o envelope do contrato e registra sem PII', async () => {
    const turn = await turnFor('AGENT');
    const before = calls.query;
    const res = await call('test_query', turn, {
      q: 'pedido da Maria',
      phone: '+55 11 98765-4321',
      email: 'maria@example.com',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      decision: 'executed',
      public_event: { type: 'tool_result' },
    });
    expect(res.body.result_id).toBe(res.body.public_event.result_id);
    expect(calls.query).toBe(before + 1);

    const [log] = await logsOf(turn.turnId);
    expect(log).toMatchObject({ decision: 'executed', toolKey: 'test_query', errorCode: null });
    expect(log?.resultMeta).toMatchObject({ result_id: res.body.result_id, call: 1 });
    const stored = JSON.stringify(log?.argsRedacted);
    expect(stored).not.toContain('98765');
    expect(stored).not.toContain('maria@example.com');
    expect(stored).not.toMatch(/maria/i);
    expect(stored).toContain('[redacted:string]');
  });

  it('ferramenta inexistente → 404 tool_not_found, registrada', async () => {
    const turn = await turnFor('OWNER');
    const res = await call('nao_existe', turn, { phone: '11987654321' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'tool_not_found' });
    const [log] = await logsOf(turn.turnId);
    expect(log).toMatchObject({
      decision: 'denied',
      errorCode: 'tool_not_found',
      toolKey: 'nao_existe',
    });
    expect(JSON.stringify(log?.argsRedacted)).not.toContain('987654');
  });

  it('args com campo extra → invalid_args (nada executa), registrado sem PII', async () => {
    const turn = await turnFor('OWNER');
    const before = writes.count;
    const res = await call('test_write', turn, {
      ids: [deal()],
      to: 'R',
      member_id: randomUUID(),
      email: 'joao@example.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.decision).toBe('invalid_args');
    expect(res.body.model_view).toContain(COPILOT_MODEL_VIEWS.invalidArgs);
    expect(res.body.model_view).not.toContain('joao@example.com');
    expect(writes.count).toBe(before);
    const [log] = await logsOf(turn.turnId);
    expect(log).toMatchObject({ decision: 'invalid_args', errorCode: 'invalid_args' });
    expect(JSON.stringify(log?.argsRedacted)).not.toContain('joao@example.com');
  });

  it('membro rebaixado entre duas chamadas: a 2ª vira proposta blocked por role', async () => {
    const turn = await turnFor('SUPERVISOR');
    const memberId = seeded.members.SUPERVISOR.id;
    const first = await call('test_write', turn, { ids: [deal()], to: 'R' });
    expect(first.body).toMatchObject({ ok: true, decision: 'executed' });

    await getDb()
      .update(schema.members)
      .set({ role: 'READONLY' })
      .where(eq(schema.members.id, memberId));
    try {
      const before = writes.count;
      const second = await call('test_write', turn, { ids: [deal()], to: 'R' });
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({
        ok: false,
        decision: 'blocked',
        model_view: { reason: 'role' },
        public_event: { type: 'action_blocked', reason: 'role' },
      });
      expect(writes.count).toBe(before);
      const [log] = await logsOf(turn.turnId);
      expect(log).toMatchObject({ decision: 'blocked', riskLevel: 2, errorCode: null });
    } finally {
      await getDb()
        .update(schema.members)
        .set({ role: 'SUPERVISOR' })
        .where(eq(schema.members.id, memberId));
    }
  });

  it('membro desativado no meio do turno → recusa por role', async () => {
    const turn = await turnFor('ADMIN');
    const memberId = seeded.members.ADMIN.id;
    await getDb()
      .update(schema.members)
      .set({ status: 'blocked' })
      .where(eq(schema.members.id, memberId));
    try {
      const res = await call('test_query', turn);
      expect(res.body.decision).toBe('denied');
      const [log] = await logsOf(turn.turnId);
      expect(log?.errorCode).toBe('capability_denied:role');
    } finally {
      await getDb()
        .update(schema.members)
        .set({ status: 'active' })
        .where(eq(schema.members.id, memberId));
    }
  });

  it('assinatura expirada: escrita vira blocked{subscription_inactive}; consulta passa', async () => {
    const turn = await turnFor('OWNER');
    await setSubscription('expired');
    const before = { ...snapshot(), writes: writes.count };
    const write = await call('test_write', turn, { ids: [deal()], to: 'R' });
    expect(write.body).toMatchObject({
      ok: false,
      decision: 'blocked',
      public_event: { type: 'action_blocked', reason: 'subscription_inactive' },
    });
    expect(writes.count).toBe(before.writes);
    const [log] = await logsOf(turn.turnId);
    expect(log).toMatchObject({ decision: 'blocked', errorCode: null });
    const proposal = await withWorkspace(seeded.workspaceId, (tx) =>
      copilotProposalsRepo.getWithItems(tx, String(write.body.model_view.proposal_id)),
    );
    expect(proposal?.proposal).toMatchObject({
      status: 'blocked',
      blockedReason: 'subscription_inactive',
    });

    const query = await call('test_query', turn);
    expect(query.body).toMatchObject({ ok: true, decision: 'executed' });
    expect(calls.query).toBe(before.query + 1);
  });

  it('papel sem a capacidade (READONLY move) → blocked role com "Pedir aprovação"', async () => {
    const turn = await turnFor('READONLY');
    const res = await call('test_write', turn, { ids: [deal()], to: 'R' });
    expect(res.body).toMatchObject({
      decision: 'blocked',
      public_event: { reason: 'role', can_request_approval: true },
    });
  });

  it('Copiloto desligado no meio do turno → copilot_disabled', async () => {
    const turn = await turnFor('OWNER');
    await withWorkspace(seeded.workspaceId, (tx) =>
      tx.insert(schema.copilotSettings).values({ workspaceId: seeded.workspaceId, enabled: false }),
    );
    try {
      const res = await call('test_query', turn);
      expect(res.body.model_view).toBe(COPILOT_MODEL_VIEWS.denied.copilot_disabled);
      expect((await logsOf(turn.turnId))[0]?.errorCode).toBe('capability_denied:copilot_disabled');
    } finally {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx
          .delete(schema.copilotSettings)
          .where(eq(schema.copilotSettings.workspaceId, seeded.workspaceId)),
      );
    }
  });

  it('orçamento: no teto a escrita para e a consulta segue; no teto duro, nada passa', async () => {
    const turn = await turnFor('OWNER');
    const insertCost = (costUsd: string) =>
      withWorkspace(seeded.workspaceId, (tx) =>
        tx.insert(schema.llmUsageLogs).values({
          workspaceId: seeded.workspaceId,
          requestType: 'chat',
          model: 'test/model',
          costUsd,
          surface: 'copilot',
        }),
      );
    try {
      await insertCost('31'); // teto padrão 30 → queries_only: o MOTOR recusa a escrita
      expect((await call('test_write', turn, { ids: [deal()], to: 'R' })).body).toMatchObject({
        decision: 'blocked',
        public_event: { reason: 'budget' },
      });
      expect((await call('test_query', turn)).body.decision).toBe('executed');
      await insertCost('5'); // 36 = 120 % → teto duro: a porta do callback recusa tudo
      expect((await call('test_query', turn)).body.model_view).toBe(
        COPILOT_MODEL_VIEWS.denied.budget,
      );
      const before = writes.count;
      expect((await call('test_write', turn, { ids: [deal()], to: 'R' })).body).toEqual({
        ok: false,
        decision: 'denied',
        model_view: COPILOT_MODEL_VIEWS.denied.budget,
      });
      expect(writes.count).toBe(before);
    } finally {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx
          .delete(schema.llmUsageLogs)
          .where(eq(schema.llmUsageLogs.workspaceId, seeded.workspaceId)),
      );
    }
  });

  it('gasto dos AGENTES de atendimento não conta no orçamento do Copiloto', async () => {
    const turn = await turnFor('OWNER');
    try {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx.insert(schema.llmUsageLogs).values({
          workspaceId: seeded.workspaceId,
          requestType: 'chat',
          model: 'test/model',
          costUsd: '500',
          surface: 'agent',
        }),
      );
      expect((await call('test_write', turn, { ids: [deal()], to: 'R' })).body.decision).toBe(
        'executed',
      );
    } finally {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx
          .delete(schema.llmUsageLogs)
          .where(eq(schema.llmUsageLogs.workspaceId, seeded.workspaceId)),
      );
    }
  });

  it('ferramenta que lê conteúdo de contato marca o turno ANTES de devolver', async () => {
    const turn = await turnFor('OWNER');
    const res = await call('test_taint', turn);
    expect(res.body.decision).toBe('executed');
    const [row] = await withWorkspace(seeded.workspaceId, (tx) =>
      tx
        .select({ tainted: schema.copilotTurns.tainted })
        .from(schema.copilotTurns)
        .where(eq(schema.copilotTurns.id, turn.turnId)),
    );
    expect(row?.tainted).toBe(true);
  });

  it('consulta comum não contamina o turno', async () => {
    const turn = await turnFor('OWNER');
    await call('test_query', turn);
    const [row] = await withWorkspace(seeded.workspaceId, (tx) =>
      tx
        .select({ tainted: schema.copilotTurns.tainted })
        .from(schema.copilotTurns)
        .where(eq(schema.copilotTurns.id, turn.turnId)),
    );
    expect(row?.tainted).toBe(false);
  });

  it('handler que lança → envelope de erro seguro, registrado, sem corpo cru', async () => {
    const turn = await turnFor('OWNER');
    const res = await call('test_boom', turn);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      decision: 'error',
      model_view: COPILOT_MODEL_VIEWS.error,
    });
    expect(JSON.stringify(res.body)).not.toContain('maria');
    const [log] = await logsOf(turn.turnId);
    expect(log).toMatchObject({ decision: 'error', errorCode: 'handler_failed' });
  });

  it('todas as chamadas do turno ficam registradas, em ordem', async () => {
    const turn = await turnFor('OWNER');
    await call('test_query', turn);
    await call('test_write', turn, { ids: [deal()], to: 'R', extra: 1 });
    await call('nao_existe', turn);
    const logs = await logsOf(turn.turnId);
    expect(logs.map((l) => l.decision).sort()).toEqual(['denied', 'executed', 'invalid_args']);
    expect(logs.every((l) => l.memberId === seeded.members.OWNER.id)).toBe(true);
    expect(logs.every((l) => typeof l.durationMs === 'number')).toBe(true);
  });
});

describe('escritas pelo motor (authorization: engine) — F73-S05', () => {
  it('AGENT pede campaign.pause → action_blocked{role, can_request_approval}, gravada e auditada', async () => {
    const turn = await turnFor('AGENT');
    const id = deal();
    const res = await call('propose_campaign_pause', turn, { ids: [id], to: 'Pausada' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      decision: 'blocked',
      model_view: { status: 'blocked', reason: 'role', risk_level: 4, can_request_approval: true },
      public_event: {
        type: 'action_blocked',
        reason: 'role',
        capability: 'campaign.pause',
        can_request_approval: true,
      },
    });
    const proposalId = String(res.body.public_event.proposal_id);
    const stored = await withWorkspace(seeded.workspaceId, (tx) =>
      copilotProposalsRepo.getWithItems(tx, proposalId),
    );
    expect(stored?.proposal).toMatchObject({
      status: 'blocked',
      blockedReason: 'role',
      riskLevel: 4,
      requestedByMemberId: seeded.members.AGENT.id,
      turnId: turn.turnId,
    });
    expect(stored?.items.map((i) => i.targetId)).toEqual([id]);
    const audit = await getDb()
      .select({ action: schema.auditLogs.action, actorType: schema.auditLogs.actorType })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.copilotProposalId, proposalId));
    expect(audit).toEqual([{ action: 'copilot.proposal.blocked', actorType: 'copilot' }]);
    const [log] = await logsOf(turn.turnId);
    expect(log).toMatchObject({
      decision: 'blocked',
      riskLevel: 4,
      toolKey: 'propose_campaign_pause',
      errorCode: null,
    });
    expect(store.countExecutions(id)).toBe(0);
  });

  it('capacidade desligada na matriz para o papel: a porta deixa passar, o motor bloqueia', async () => {
    const turn = await turnFor('AGENT');
    await withWorkspace(seeded.workspaceId, (tx) =>
      tx.insert(schema.copilotSettings).values({
        workspaceId: seeded.workspaceId,
        capabilityMatrix: { AGENT: { 'deal.move': false } },
      }),
    );
    try {
      const id = deal();
      const res = await call('test_write', turn, { ids: [id], to: 'R' });
      expect(res.body).toMatchObject({
        decision: 'blocked',
        public_event: { reason: 'capability_disabled', can_request_approval: false },
      });
      expect(store.countExecutions(id)).toBe(0);
    } finally {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx
          .delete(schema.copilotSettings)
          .where(eq(schema.copilotSettings.workspaceId, seeded.workspaceId)),
      );
    }
  });

  it('a porta do callback continua valendo para escrita: Copiloto desligado → denied', async () => {
    const turn = await turnFor('OWNER');
    await withWorkspace(seeded.workspaceId, (tx) =>
      tx.insert(schema.copilotSettings).values({ workspaceId: seeded.workspaceId, enabled: false }),
    );
    try {
      const before = writes.count;
      const res = await call('test_write', turn, { ids: [deal()], to: 'R' });
      expect(res.body).toEqual({
        ok: false,
        decision: 'denied',
        model_view: COPILOT_MODEL_VIEWS.denied.copilot_disabled,
      });
      expect(writes.count).toBe(before);
    } finally {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx
          .delete(schema.copilotSettings)
          .where(eq(schema.copilotSettings.workspaceId, seeded.workspaceId)),
      );
    }
  });

  it('consulta continua com a autorização COMPLETA no callback (matriz desliga → denied)', async () => {
    const turn = await turnFor('AGENT');
    await withWorkspace(seeded.workspaceId, (tx) =>
      tx.insert(schema.copilotSettings).values({
        workspaceId: seeded.workspaceId,
        capabilityMatrix: { AGENT: { query: false } },
      }),
    );
    try {
      const before = snapshot();
      const res = await call('test_query', turn);
      expect(res.body).toEqual({
        ok: false,
        decision: 'denied',
        model_view: COPILOT_MODEL_VIEWS.denied.capability_disabled,
      });
      expect(snapshot()).toEqual(before);
    } finally {
      await withWorkspace(seeded.workspaceId, (tx) =>
        tx
          .delete(schema.copilotSettings)
          .where(eq(schema.copilotSettings.workspaceId, seeded.workspaceId)),
      );
    }
  });

  it('loadToolOfferContext: papéis dos OUTROS membros ativos', async () => {
    const ctx = await withWorkspace(seeded.workspaceId, (tx) =>
      loadToolOfferContext(tx, {
        workspaceId: seeded.workspaceId,
        memberId: seeded.members.OWNER.id,
      }),
    );
    expect([...ctx.otherActiveRoles].sort()).toEqual(['ADMIN', 'AGENT', 'READONLY', 'SUPERVISOR']);
  });
});

describe('efeitos pós-commit (ctx.afterCommit) — F73-S05', () => {
  it('saem depois do commit; ferramenta que falha descarta os dela', async () => {
    const turn = await turnFor('OWNER');
    const before = calls.effects;
    expect((await call('test_effects', turn, { broken: false })).body.decision).toBe('executed');
    expect(calls.effects).toBe(before + 1);
    const broken = await call('test_effects', turn, { broken: true });
    expect(broken.body.decision).toBe('error');
    expect(calls.effects).toBe(before + 1);
  });

  it('nível 2 pelo callback: o progresso só sai depois do commit; transação que falha não emite nada', async () => {
    const turn = await turnFor('OWNER');
    const okId = deal();
    const emittedBefore = deps.emitted.length;
    const ok = await call('test_write', turn, { ids: [okId], to: 'R' });
    expect(ok.body.decision).toBe('executed');
    expect(deps.emitted.length).toBe(emittedBefore + 1);
    expect(store.afterCommitEvents).toContain(`exec:${okId}`);

    // A transação do callback falha DEPOIS do handler (o log não grava): rollback total.
    const failId = deal();
    const spy = vi
      .spyOn(copilotToolCallsRepo, 'insert')
      .mockRejectedValueOnce(new Error('falha ao gravar o log'));
    try {
      const failed = await call('test_write', turn, { ids: [failId], to: 'R' });
      expect(failed.body).toEqual({
        ok: false,
        decision: 'error',
        model_view: COPILOT_MODEL_VIEWS.error,
      });
    } finally {
      spy.mockRestore();
    }
    expect(deps.emitted.length).toBe(emittedBefore + 1);
    expect(store.afterCommitEvents).not.toContain(`exec:${failId}`);
    const items = await getDb()
      .select({ id: schema.copilotActionItems.id })
      .from(schema.copilotActionItems)
      .where(eq(schema.copilotActionItems.targetId, failId));
    expect(items).toHaveLength(0);
  });
});
