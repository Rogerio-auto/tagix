/**
 * F73-S10 — sessões e histórico do Copiloto pela composição REAL (`createCopilotRouter`:
 * porta `requireAuth → withRLS → copilotAvailable` + este router), contra o Postgres de dev.
 *
 * - sessões são privadas: as de outro membro respondem 404 (sem oráculo);
 * - arquivada some da lista; renomear e arquivar são do dono;
 * - histórico revalida `blocks`/`tool_results` no contrato e pagina por cursor;
 * - view-as → 403 em tudo (inclusive o POST da pergunta).
 */
import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, copilotMessagesRepo, withWorkspace } from '@hm/db';
import {
  CopilotMessagePageSchema,
  CopilotSessionPageSchema,
  CopilotSessionSchema,
} from '@hm/shared';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import { createCopilotRouter } from '../index';

let seeded: SeededWorkspace;

function buildApp(options: { impersonate?: boolean } = {}): Express {
  const app = express();
  app.use(express.json());
  if (options.impersonate) {
    app.use((req, _res, next) => {
      req.impersonation = {
        sessionId: randomUUID(),
        targetWorkspaceId: seeded.workspaceId,
        adminMemberId: randomUUID(),
        mode: 'view',
      };
      next();
    });
  }
  app.use(createCopilotRouter());
  return app;
}

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Sessions' });
});

afterAll(async () => {
  await seeded?.cleanup();
  await closeDb();
});

describe('sessões do Copiloto', () => {
  const app = buildApp();

  it('cria, lista só as próprias, renomeia e arquiva (some da lista)', async () => {
    const owner = seeded.members.OWNER;
    const agent = seeded.members.AGENT;
    const created = await request(app)
      .post('/api/copilot/sessions')
      .set('Cookie', owner.cookie)
      .send({ origin: 'docked', page_context: { route: '/pipeline' } });
    expect(created.status).toBe(201);
    const session = CopilotSessionSchema.parse(created.body);
    expect(session).toMatchObject({ origin: 'docked', title: 'Nova conversa', archived_at: null });

    await request(app)
      .post('/api/copilot/sessions')
      .set('Cookie', agent.cookie)
      .send({ origin: 'bubble' });

    const list = await request(app).get('/api/copilot/sessions').set('Cookie', owner.cookie);
    expect(list.status).toBe(200);
    const page = CopilotSessionPageSchema.parse(list.body);
    expect(page.data.map((s) => s.id)).toEqual([session.id]);

    const renamed = await request(app)
      .patch(`/api/copilot/sessions/${session.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: '  Funil de outubro  ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Funil de outubro');

    // Outro membro: 404 em tudo (igual a inexistente).
    for (const req of [
      request(app)
        .patch(`/api/copilot/sessions/${session.id}`)
        .set('Cookie', agent.cookie)
        .send({ title: 'x' }),
      request(app).delete(`/api/copilot/sessions/${session.id}`).set('Cookie', agent.cookie),
      request(app).get(`/api/copilot/sessions/${session.id}/messages`).set('Cookie', agent.cookie),
      request(app)
        .post(`/api/copilot/sessions/${session.id}/messages`)
        .set('Cookie', agent.cookie)
        .send({ text: 'oi', origin: 'bubble', client_request_id: randomUUID() }),
    ]) {
      const res = await req;
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('session_not_found');
    }

    const archived = await request(app)
      .delete(`/api/copilot/sessions/${session.id}`)
      .set('Cookie', owner.cookie);
    expect(archived.status).toBe(204);
    const after = await request(app).get('/api/copilot/sessions').set('Cookie', owner.cookie);
    expect(CopilotSessionPageSchema.parse(after.body).data).toEqual([]);

    // Arquivada: o histórico continua do dono, mas não aceita pergunta nova.
    expect(
      (
        await request(app)
          .get(`/api/copilot/sessions/${session.id}/messages`)
          .set('Cookie', owner.cookie)
      ).status,
    ).toBe(200);
    const ask = await request(app)
      .post(`/api/copilot/sessions/${session.id}/messages`)
      .set('Cookie', owner.cookie)
      .send({ text: 'oi', origin: 'bubble', client_request_id: randomUUID() });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toBe('session_archived');
  });

  it('lista paginada por cursor; cursor adulterado → 400', async () => {
    const member = seeded.members.SUPERVISOR;
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/copilot/sessions')
        .set('Cookie', member.cookie)
        .send({ origin: 'bubble' });
    }
    const first = CopilotSessionPageSchema.parse(
      (await request(app).get('/api/copilot/sessions?limit=2').set('Cookie', member.cookie)).body,
    );
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = CopilotSessionPageSchema.parse(
      (
        await request(app)
          .get(
            `/api/copilot/sessions?limit=2&cursor=${encodeURIComponent(first.next_cursor ?? '')}`,
          )
          .set('Cookie', member.cookie)
      ).body,
    );
    expect(second.data).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    const bad = await request(app)
      .get('/api/copilot/sessions?cursor=nao-e-cursor')
      .set('Cookie', member.cookie);
    expect(bad.status).toBe(400);
  });

  it('histórico: ordem cronológica, blocos e cartões revalidados (inválido → null)', async () => {
    const owner = seeded.members.OWNER;
    const created = await request(app)
      .post('/api/copilot/sessions')
      .set('Cookie', owner.cookie)
      .send({ origin: 'bubble' });
    const sessionId = CopilotSessionSchema.parse(created.body).id;
    await withWorkspace(seeded.workspaceId, async (tx) => {
      await copilotMessagesRepo.append(tx, {
        workspaceId: seeded.workspaceId,
        sessionId,
        role: 'user',
        content: 'Pergunta',
      });
      await copilotMessagesRepo.append(tx, {
        workspaceId: seeded.workspaceId,
        sessionId,
        role: 'assistant',
        content: 'Veredito',
        blocks: { verdict: 'Veredito', why: [], data_refs: [], sources: [], next_steps: [] },
        toolResults: [{ kind: 'kpis', lixo: true }],
      });
    });
    const res = await request(app)
      .get(`/api/copilot/sessions/${sessionId}/messages`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    const page = CopilotMessagePageSchema.parse(res.body);
    expect(page.data.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Pergunta'],
      ['assistant', 'Veredito'],
    ]);
    expect(page.data[1]?.blocks?.verdict).toBe('Veredito');
    expect(page.data[1]?.tool_results).toBeNull();
  });

  it('id que não é UUID → 404; corpo com campo extra → 400', async () => {
    const owner = seeded.members.OWNER;
    expect(
      (await request(app).get('/api/copilot/sessions/abc/messages').set('Cookie', owner.cookie))
        .status,
    ).toBe(404);
    const extra = await request(app)
      .post('/api/copilot/sessions')
      .set('Cookie', owner.cookie)
      .send({ origin: 'bubble', member_id: owner.id });
    expect(extra.status).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/copilot/turns/${randomUUID()}/cancel`)
          .set('Cookie', owner.cookie)
      ).status,
    ).toBe(404);
  });

  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/copilot/sessions')).status).toBe(401);
  });
});

describe('view-as', () => {
  const app = buildApp({ impersonate: true });

  it.each([
    ['get', '/api/copilot/sessions'],
    ['post', '/api/copilot/sessions'],
    ['post', `/api/copilot/sessions/${randomUUID()}/messages`],
    ['post', `/api/copilot/turns/${randomUUID()}/cancel`],
  ] as const)('%s %s → 403 copilot_unavailable_impersonation', async (method, path) => {
    const agent = request(app);
    const res = await agent[method](path)
      .set('Cookie', seeded.members.OWNER.cookie)
      .send({ text: 'oi', origin: 'bubble', client_request_id: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('copilot_unavailable_impersonation');
  });
});
