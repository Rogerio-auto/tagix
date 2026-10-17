/**
 * F73-S05 — Atividade (A8) e exportação CSV, com a porta de produção sobre o Postgres de dev.
 *
 * - `mine` paginada por cursor (sem repetir nem pular);
 * - `scope=all` e CSV exigem `copilot.activity.view_all` (403 para o atendente);
 * - linhas `blocked` aparecem, com o motivo;
 * - o CSV não carrega telefone nem e-mail (nem de contato, nem de membro).
 */
import { randomUUID } from 'node:crypto';
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withWorkspace } from '@hm/db';
import { ActivityPageSchema, type Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../../middlewares/auth';
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
} from '../../../services/copilot/proposals/test-fixtures';
import { createCopilotActivityRouter } from './index';

let seeded: SeededWorkspace;
let app: Express;
const store = new FakeStore();
const deps = makeTestDeps(store);

const PII_TO = 'maria.souza@cliente.com.br +55 (11) 98888-7777';

async function propose(role: Role, capability: 'deal.move' | 'campaign.pause', args: FakeArgs) {
  const executor = deps.executors.get(capability)!;
  return withWorkspace(seeded.workspaceId, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: seeded.workspaceId,
      memberId: seeded.members[role].id,
    });
    return proposeAction(
      deps,
      { tx, principal: principal!, source: 'copilot', turnId: null, sessionId: null },
      executor,
      args,
    );
  });
}

function ids(n: number): string[] {
  return Array.from({ length: n }, () => {
    const id = randomUUID();
    store.add(id);
    return id;
  });
}

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Activity' });
  const a = express();
  a.use(express.json());
  const router = Router();
  router.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
  router.use(createCopilotActivityRouter());
  a.use(router);
  app = a;
  // 5 do atendente (1 com "PII" no resumo e 1 bloqueada), 2 do dono.
  for (let i = 0; i < 3; i++)
    await propose('AGENT', 'deal.move', { ids: ids(2), to: `Etapa ${i}` });
  await propose('AGENT', 'deal.move', { ids: ids(1), to: PII_TO });
  await propose('AGENT', 'campaign.pause', { ids: ids(1), to: 'P' });
  await propose('OWNER', 'deal.move', { ids: ids(2), to: 'Dono A' });
  await propose('OWNER', 'deal.move', { ids: ids(2), to: 'Dono B' });
});

afterAll(async () => {
  await drainProposalExecutions();
  await seeded?.cleanup();
  await closeDb();
});

const cookie = (role: Role): string => seeded.members[role].cookie;

describe('GET /api/copilot/activity', () => {
  it('mine: paginada por cursor, só o que EU pedi, sem repetir', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/copilot/activity?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(app).get(url).set('Cookie', cookie('AGENT'));
      expect(res.status).toBe(200);
      const page = ActivityPageSchema.parse(res.body);
      seen.push(...page.data.map((e) => e.id));
      for (const e of page.data) expect(e.requested_by?.member_id).toBe(seeded.members.AGENT.id);
      cursor = page.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(pages).toBe(3);
  });

  it('inclui a bloqueada com o motivo; a nível 2 executada mostra Desfazer', async () => {
    const res = await request(app).get('/api/copilot/activity').set('Cookie', cookie('AGENT'));
    const page = ActivityPageSchema.parse(res.body);
    const blocked = page.data.find((e) => e.status === 'blocked');
    expect(blocked).toMatchObject({ blocked_reason: 'role', capability: 'campaign.pause' });
    const l2 = page.data.find((e) => e.status === 'completed');
    expect(l2).toMatchObject({ can_undo: true, risk_level: 2 });
    expect(l2?.executed_as?.member_id).toBe(seeded.members.AGENT.id);
  });

  it('scope=all: atendente 403; gestor vê as 7 do workspace', async () => {
    const denied = await request(app)
      .get('/api/copilot/activity?scope=all')
      .set('Cookie', cookie('AGENT'));
    expect(denied.status).toBe(403);
    const res = await request(app)
      .get('/api/copilot/activity?scope=all&limit=50')
      .set('Cookie', cookie('SUPERVISOR'));
    expect(res.status).toBe(200);
    const page = ActivityPageSchema.parse(res.body);
    expect(page.data).toHaveLength(7);
    expect(page.next_cursor).toBeNull();
  });

  it('cursor adulterado → 400; parâmetro desconhecido → 400', async () => {
    const bad = await request(app)
      .get('/api/copilot/activity?cursor=bm9wZQ')
      .set('Cookie', cookie('AGENT'));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_cursor');
    const extra = await request(app)
      .get('/api/copilot/activity?member_id=x')
      .set('Cookie', cookie('AGENT'));
    expect(extra.status).toBe(400);
  });
});

describe('GET /api/copilot/activity.csv', () => {
  it('atendente → 403', async () => {
    const res = await request(app).get('/api/copilot/activity.csv').set('Cookie', cookie('AGENT'));
    expect(res.status).toBe(403);
  });

  it('gestor: CSV com cabeçalho e 7 linhas, sem telefone nem e-mail', async () => {
    const res = await request(app)
      .get('/api/copilot/activity.csv')
      .set('Cookie', cookie('OWNER'))
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (chunk: string) => {
          data += chunk;
        });
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = String(res.body);
    const lines = text
      .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'data,origem,pedido_por,executado_como,aprovador,acao,nivel,status,resumo,itens,feitos,pulados,falhas,desfeitos,motivo_bloqueio',
    );
    expect(lines).toHaveLength(8);
    // Nem o e-mail/telefone do "contato" no resumo, nem o e-mail dos membros.
    expect(text).not.toMatch(/maria\.souza|cliente\.com|98888|7777/);
    for (const m of Object.values(seeded.members)) expect(text).not.toContain(m.email);
    expect(text).toContain('[e-mail]');
    expect(text).toContain('[telefone]');
    expect(text).toContain('Mover negócios');
  });
});
