/**
 * F73-S13 · API do piloto automático com a MESMA porta de produção (`requireAuth → withRLS →
 * copilotAvailable`) sobre o Postgres e o Redis de dev: regras, fila e decisão em lote.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { AutopilotRuleSchema, SuggestionPageSchema, type Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../../middlewares/auth';
import { closeRateLimit } from '../../../middlewares/rate-limit';
import { copilotAvailable } from '../../../services/copilot/identity/available';
import {
  captureEmitter,
  dealStage,
  seedCrmWorld,
  seedSuggestion,
  suggestionRow,
  type CrmWorld,
} from '../../../services/copilot/autopilot/test-fixtures';
import { createCopilotRouter } from '../index';
import { createCopilotAutopilotRouter } from './index';

let world: CrmWorld;
let disabled: CrmWorld;
let app: Express;
const cap = captureEmitter();

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  const router = Router();
  router.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
  router.use(createCopilotAutopilotRouter({ deps: world.deps, emit: cap.emit }));
  a.use(router);
  return a;
}

const cookie = (role: Role): string => world.ws.members[role].cookie;

beforeAll(async () => {
  disabled = await seedCrmWorld('AutopilotRoutesOff');
  world = await seedCrmWorld('AutopilotRoutes');
  await getDb()
    .insert(schema.copilotSettings)
    .values({ workspaceId: disabled.ws.workspaceId, enabled: false });
  app = buildApp();
});

afterAll(async () => {
  await world?.cleanup();
  await disabled?.cleanup();
  await closeRateLimit();
  await closeDb();
});

function rule(
  stageId: string,
  over: Partial<{
    mode: string;
    idle_days: number;
    target: string;
    outbound: boolean;
    daily_limit: number;
  }> = {},
) {
  return {
    stage_id: stageId,
    mode: over.mode ?? 'suggest',
    criteria: {
      idle_days: over.idle_days ?? 7,
      target_stage_id: over.target ?? world.stage.reativacao,
      require_last_outbound: over.outbound ?? true,
    },
    daily_limit: over.daily_limit ?? 10,
  };
}

const put = (role: Role, rules: unknown[]) =>
  request(app).put('/api/copilot/autopilot/rules').set('Cookie', cookie(role)).send({ rules });

async function auditActions(stageId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ action: schema.auditLogs.action, createdAt: schema.auditLogs.createdAt })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.workspaceId, world.ws.workspaceId),
        eq(schema.auditLogs.resourceType, 'copilot_autopilot_rule'),
        eq(schema.auditLogs.resourceId, stageId),
      ),
    );
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((r) => r.action);
}

describe('GET /api/copilot/autopilot/rules', () => {
  it('sem sessão: 401; READONLY lê (pipeline.view é de todos); começa vazio', async () => {
    expect((await request(app).get('/api/copilot/autopilot/rules')).status).toBe(401);
    const res = await request(app)
      .get('/api/copilot/autopilot/rules')
      .set('Cookie', cookie('READONLY'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});

describe('PUT /api/copilot/autopilot/rules', () => {
  it('sem copilot.autopilot.manage: 403 (SUPERVISOR, AGENT, READONLY), e nada é gravado', async () => {
    for (const role of ['SUPERVISOR', 'AGENT', 'READONLY'] as const) {
      const res = await put(role, [rule(world.stage.flow)]);
      expect(res.status).toBe(403);
    }
    const list = await request(app)
      .get('/api/copilot/autopilot/rules')
      .set('Cookie', cookie('OWNER'));
    expect(list.body.data).toEqual([]);
  });

  it('ADMIN liga: grava, devolve o contrato, quem ligou e o audit "enabled"; igual de novo não audita', async () => {
    const res = await put('ADMIN', [rule(world.stage.orcamento, { mode: 'daily_approval' })]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const dto = AutopilotRuleSchema.parse(res.body.data[0]);
    expect(dto).toMatchObject({
      stage_id: world.stage.orcamento,
      stage_name: 'Orçamento enviado',
      pipeline_id: world.pipeline,
      mode: 'daily_approval',
      daily_limit: 10,
      criteria: {
        idle_days: 7,
        target_stage_id: world.stage.reativacao,
        require_last_outbound: true,
      },
      enabled_by: { member_id: world.ws.members.ADMIN.id },
    });
    expect(dto.enabled_by?.name).toContain('ADMIN');
    expect(dto.enabled_at).not.toBeNull();
    expect(await auditActions(world.stage.orcamento)).toEqual(['copilot.autopilot.enabled']);

    const [log] = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, world.stage.orcamento));
    expect(log).toMatchObject({
      actorType: 'member',
      actorMemberId: world.ws.members.ADMIN.id,
      workspaceId: world.ws.workspaceId,
    });
    expect(log?.metadata).toMatchObject({
      from_mode: null,
      to_mode: 'daily_approval',
      idle_days: 7,
    });

    // Mesmo corpo: nada muda, nada audita, e quem ligou continua sendo o ADMIN.
    const again = await put('OWNER', [rule(world.stage.orcamento, { mode: 'daily_approval' })]);
    expect(again.status).toBe(200);
    expect(again.body.data[0].enabled_by.member_id).toBe(world.ws.members.ADMIN.id);
    expect(await auditActions(world.stage.orcamento)).toEqual(['copilot.autopilot.enabled']);

    // Outro critério: audita como alteração e `enabled_by` não troca.
    const edit = await put('OWNER', [
      rule(world.stage.orcamento, { mode: 'suggest', idle_days: 10 }),
    ]);
    expect(edit.body.data[0]).toMatchObject({ mode: 'suggest', criteria: { idle_days: 10 } });
    expect(edit.body.data[0].enabled_by.member_id).toBe(world.ws.members.ADMIN.id);
    expect(await auditActions(world.stage.orcamento)).toEqual([
      'copilot.autopilot.enabled',
      'copilot.autopilot.rule_changed',
    ]);
  });

  it('mode "auto": 409 feature_not_available e NADA do lote é gravado', async () => {
    const res = await put('OWNER', [
      rule(world.stage.flow, { mode: 'suggest' }),
      rule(world.stage.avisar, { mode: 'auto' }),
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.message).toContain('ainda não está disponível');
    const rows = await getDb()
      .select()
      .from(schema.copilotAutopilotRules)
      .where(eq(schema.copilotAutopilotRules.workspaceId, world.ws.workspaceId));
    expect(rows.map((r) => r.stageId)).not.toContain(world.stage.flow);
    expect(rows.map((r) => r.stageId)).not.toContain(world.stage.avisar);
    expect(rows.map((r) => r.mode)).not.toContain('auto');
  });

  it('valida: destino de outro funil, igual à origem, inexistente, estágio inexistente, duplicado', async () => {
    const [p2] = await getDb()
      .insert(schema.pipelines)
      .values({ workspaceId: world.ws.workspaceId, name: 'Outro funil' })
      .returning();
    const [s2] = await getDb()
      .insert(schema.stages)
      .values({ workspaceId: world.ws.workspaceId, pipelineId: p2!.id, name: 'Lá', position: 0 })
      .returning();

    const cases: Array<[unknown[], string, string]> = [
      [[rule(world.stage.flow, { target: s2!.id })], 'invalid_rule', 'target_other_pipeline'],
      [[rule(world.stage.flow, { target: world.stage.flow })], 'invalid_rule', 'target_is_stage'],
      [[rule(world.stage.flow, { target: randomUUID() })], 'invalid_rule', 'target_not_found'],
      [[rule(randomUUID())], 'invalid_rule', 'stage_not_found'],
      [[rule(world.stage.flow), rule(world.stage.flow)], 'invalid_rule', 'duplicate_stage'],
    ];
    for (const [rules, error, reason] of cases) {
      const res = await put('ADMIN', rules);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error, reason });
      expect(typeof res.body.message).toBe('string');
    }
    // Desligar não exige destino válido (a regra fica guardada, parada).
    const off = await put('ADMIN', [rule(world.stage.flow, { mode: 'off', target: randomUUID() })]);
    expect(off.status).toBe(200);
  });

  it('limites do contrato: idle_days 1..60, daily_limit 1..50, corpo estrito → 400', async () => {
    const bad = [
      [rule(world.stage.avisar, { idle_days: 0 })],
      [rule(world.stage.avisar, { idle_days: 61 })],
      [rule(world.stage.avisar, { daily_limit: 0 })],
      [rule(world.stage.avisar, { daily_limit: 51 })],
      [],
    ];
    for (const rules of bad) expect((await put('ADMIN', rules)).status).toBe(400);
    const extra = await request(app)
      .put('/api/copilot/autopilot/rules')
      .set('Cookie', cookie('ADMIN'))
      .send({ rules: [rule(world.stage.avisar)], mode: 'x' });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('invalid_body');
    // Limites de borda passam.
    expect(
      (await put('ADMIN', [rule(world.stage.avisar, { idle_days: 60, daily_limit: 50 })])).status,
    ).toBe(200);
    expect(
      (await put('ADMIN', [rule(world.stage.avisar, { idle_days: 1, daily_limit: 1 })])).status,
    ).toBe(200);
  });

  it('desligar a regra tira da fila as pendentes dela e avisa o socket só com a contagem', async () => {
    const stage = world.stage.conversao;
    await put('ADMIN', [rule(stage, { target: world.stage.reativacao })]);
    const a = await seedSuggestion(world, { title: 'Pend 1', from: stage });
    const b = await seedSuggestion(world, { title: 'Pend 2', from: stage });
    const other = await seedSuggestion(world, {
      title: 'Outra regra',
      from: world.stage.orcamento,
    });
    const before = cap.calls.length;

    const res = await put('OWNER', [rule(stage, { mode: 'off' })]);
    expect(res.status).toBe(200);
    const dto = res.body.data.find((r: { stage_id: string }) => r.stage_id === stage);
    expect(dto).toMatchObject({ mode: 'off', enabled_by: null, enabled_at: null });
    expect((await suggestionRow(world, a.id))?.status).toBe('superseded');
    expect((await suggestionRow(world, b.id))?.status).toBe('superseded');
    expect((await suggestionRow(world, other.id))?.status).toBe('pending');
    expect(await auditActions(stage)).toEqual([
      'copilot.autopilot.enabled',
      'copilot.autopilot.disabled',
    ]);
    expect(cap.calls.length).toBe(before + 1);
    expect(cap.calls.at(-1)).toMatchObject({ workspaceId: world.ws.workspaceId });
    expect(Object.keys(cap.calls.at(-1) ?? {}).sort()).toEqual(['pendingCount', 'workspaceId']);
  });
});

describe('GET /api/copilot/suggestions', () => {
  const from = (): string => world.stage.flow;

  it('devolve o contrato: negócio resumido, motivo, confiança, origem e destino', async () => {
    const s = await seedSuggestion(world, {
      title: 'Alinhador Maria',
      from: world.stage.aprovacao,
      confidence: 'high',
    });
    const res = await request(app)
      .get(`/api/copilot/suggestions?stage_id=${world.stage.aprovacao}`)
      .set('Cookie', cookie('SUPERVISOR'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const page = SuggestionPageSchema.parse(res.body);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      id: s.id,
      deal: {
        deal_id: s.dealId,
        title: 'Alinhador Maria',
        contact_name: 'Maria Souza',
        value: 1000,
        currency: 'BRL',
      },
      from_stage: { stage_id: world.stage.aprovacao, name: 'Contrato' },
      to_stage: { stage_id: world.stage.reativacao, name: 'Reativação' },
      reason_code: 'idle_last_outbound',
      confidence: 'high',
      status: 'pending',
      proposal_id: null,
      decided_by: null,
      decided_at: null,
    });
    expect(page.data[0]?.reason_text).toContain('Sem resposta há 9 dias');
    expect(page.next_cursor).toBeNull();
  });

  it('pagina por cursor sem repetir nem pular, e filtra por estágio de origem', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await seedSuggestion(world, { title: `Pág ${i}`, from: from() })).id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/copilot/suggestions?stage_id=${from()}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(app).get(url).set('Cookie', cookie('OWNER'));
      expect(res.status).toBe(200);
      const page = SuggestionPageSchema.parse(res.body);
      seen.push(...page.data.map((d) => d.id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('status: só as decididas aparecem em approved, com quem decidiu', async () => {
    const s = await seedSuggestion(world, { title: 'Aprovada', from: world.stage.avisar });
    const done = await request(app)
      .post('/api/copilot/suggestions/decide')
      .set('Cookie', cookie('ADMIN'))
      .send({ ids: [s.id], decision: 'approve' });
    expect(done.status).toBe(200);
    const res = await request(app)
      .get(`/api/copilot/suggestions?status=approved&stage_id=${world.stage.avisar}`)
      .set('Cookie', cookie('READONLY'));
    const page = SuggestionPageSchema.parse(res.body);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      status: 'approved',
      decided_by: { member_id: world.ws.members.ADMIN.id },
      proposal_id: done.body.proposals[0].proposal_id,
    });
    const pending = await request(app)
      .get(`/api/copilot/suggestions?stage_id=${world.stage.avisar}`)
      .set('Cookie', cookie('READONLY'));
    expect(pending.body.data).toEqual([]);
  });

  it('AGENT só vê sugestão de negócio do seu escopo', async () => {
    const stage = world.stage.whatsapp;
    const mine = await seedSuggestion(world, {
      title: 'Meu',
      from: stage,
      to: world.stage.reativacao,
      owner: world.ws.members.AGENT.id,
    });
    const viaConv = await seedSuggestion(world, {
      title: 'Da minha conversa',
      from: stage,
      to: world.stage.reativacao,
      owner: world.ws.members.OWNER.id,
      conv: world.conv.agent,
    });
    const theirs = await seedSuggestion(world, {
      title: 'Do dono',
      from: stage,
      to: world.stage.reativacao,
      owner: world.ws.members.OWNER.id,
    });
    const agent = await request(app)
      .get(`/api/copilot/suggestions?stage_id=${stage}`)
      .set('Cookie', cookie('AGENT'));
    const ids = SuggestionPageSchema.parse(agent.body).data.map((d) => d.id);
    expect(new Set(ids)).toEqual(new Set([mine.id, viaConv.id]));
    const owner = await request(app)
      .get(`/api/copilot/suggestions?stage_id=${stage}`)
      .set('Cookie', cookie('OWNER'));
    expect(SuggestionPageSchema.parse(owner.body).data.map((d) => d.id)).toContain(theirs.id);
  });

  it('parâmetros inválidos: 400 invalid_query / invalid_cursor', async () => {
    for (const q of ['status=nope', 'limit=0', 'limit=51', 'stage_id=x', 'extra=1']) {
      const res = await request(app)
        .get(`/api/copilot/suggestions?${q}`)
        .set('Cookie', cookie('OWNER'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_query');
    }
    const bad = await request(app)
      .get('/api/copilot/suggestions?cursor=zzzz')
      .set('Cookie', cookie('OWNER'));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_cursor');
  });
});

describe('POST /api/copilot/suggestions/decide', () => {
  const decide = (role: Role | null, body: unknown) => {
    const r = request(app).post('/api/copilot/suggestions/decide');
    return (role ? r.set('Cookie', cookie(role)) : r).send(body as object);
  };

  it('sem sessão 401; READONLY (sem deal.move) 403', async () => {
    const s = await seedSuggestion(world, { title: 'Sem permissão' });
    expect((await decide(null, { ids: [s.id], decision: 'approve' })).status).toBe(401);
    expect((await decide('READONLY', { ids: [s.id], decision: 'approve' })).status).toBe(403);
    expect((await suggestionRow(world, s.id))?.status).toBe('pending');
    expect(await dealStage(s.dealId)).toBe(world.stage.orcamento);
  });

  it('corpo inválido: 400 (vazio, > 200, repetido, decisão desconhecida, chave extra)', async () => {
    const id = randomUUID();
    const bodies = [
      { ids: [], decision: 'approve' },
      { ids: Array.from({ length: 201 }, () => randomUUID()), decision: 'approve' },
      { ids: [id, id], decision: 'approve' },
      { ids: [id], decision: 'maybe' },
      { ids: [id], decision: 'approve', force: true },
      { ids: ['nao-uuid'], decision: 'reject' },
    ];
    for (const body of bodies) {
      const res = await decide('OWNER', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_body');
    }
  });

  it('aprovar: o resultado traz resumo, itens, a proposta e a janela de 7 dias', async () => {
    const a = await seedSuggestion(world, { title: 'HTTP 1' });
    const b = await seedSuggestion(world, { title: 'HTTP 2' });
    const res = await decide('SUPERVISOR', {
      ids: [a.id, b.id, randomUUID()],
      decision: 'approve',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      decision: 'approve',
      approved: 2,
      not_found: 1,
      skipped: 0,
      in_progress: false,
      summary: 'Aprovadas 2, não encontradas 1',
    });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'approved',
      'approved',
      'not_found',
    ]);
    const ref = res.body.proposals[0];
    expect(ref).toMatchObject({ status: 'completed', to_stage_id: world.stage.reativacao });
    expect(new Date(ref.undo_until).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    expect(typeof res.body.pending_count).toBe('number');
  });

  it('AGENT: os do dono vêm como not_found e não se mexe neles', async () => {
    const mine = await seedSuggestion(world, {
      title: 'HTTP meu',
      owner: world.ws.members.AGENT.id,
    });
    const theirs = await seedSuggestion(world, {
      title: 'HTTP do dono',
      owner: world.ws.members.OWNER.id,
    });
    const res = await decide('AGENT', { ids: [mine.id, theirs.id], decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'approved',
      'not_found',
    ]);
    expect(await dealStage(theirs.dealId)).toBe(world.stage.orcamento);
    expect((await suggestionRow(world, theirs.id))?.status).toBe('pending');
  });

  it('recusar: rejected, sem proposta', async () => {
    const s = await seedSuggestion(world, { title: 'HTTP recusa' });
    const res = await decide('ADMIN', { ids: [s.id], decision: 'reject' });
    expect(res.body).toMatchObject({ rejected: 1, summary: 'Recusadas 1', proposals: [] });
    expect((await suggestionRow(world, s.id))?.status).toBe('rejected');
  });
});

describe('montagem em /api/copilot (a porta de verdade)', () => {
  it('o router do Copiloto expõe os caminhos; Copiloto desligado fecha a porta', async () => {
    const a = express();
    a.use(express.json());
    a.use(createCopilotRouter());
    const ok = await request(a).get('/api/copilot/suggestions').set('Cookie', cookie('OWNER'));
    expect(ok.status).toBe(200);
    SuggestionPageSchema.parse(ok.body);
    const rules = await request(a)
      .get('/api/copilot/autopilot/rules')
      .set('Cookie', cookie('OWNER'));
    expect(rules.status).toBe(200);
    const off = await request(a)
      .get('/api/copilot/suggestions')
      .set('Cookie', disabled.ws.members.OWNER.cookie);
    expect(off.status).toBe(403);
    expect(off.body.error).toBe('copilot_disabled');
  });
});
