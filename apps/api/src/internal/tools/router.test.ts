/**
 * Testes do endpoint interno de tools (callback Python → Node) — F2-S07.
 *
 * `@hm/db` é mockado: `withWorkspace` apenas executa o callback com um `tx`
 * fake que (a) responde a busca de `tools` por key e (b) captura o insert em
 * `tool_logs`. Sem Postgres real. Cobre: rejeição/aceite por token, tool
 * desconhecida (404), envelope inválido (400), e escrita de `tool_logs`.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

interface LogCapture {
  values: Record<string, unknown>;
}
const toolLogInserts: LogCapture[] = [];

/** key → id de `tools`. Vazio = tool não catalogada (pula auditoria). */
let toolCatalog: Record<string, string> = {};
let lastWorkspaceId: string | null = null;

function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: (cond: { key: string }) => ({
          limit: async () => {
            const id = toolCatalog[cond.key];
            return id ? [{ id }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        toolLogInserts.push({ values });
      },
    }),
  };
}

// `eq(col, val)` → `{ key: val }` para o `where` fake casar a busca por key.
vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, val: unknown) => ({ key: val }),
}));

vi.mock('@hm/db', () => ({
  withWorkspace: async (id: string, fn: (tx: unknown) => Promise<unknown>) => {
    lastWorkspaceId = id;
    return fn(makeTx());
  },
  schema: {
    tools: { id: 'id', key: 'key' },
    toolLogs: {},
  },
}));

// Import DEPOIS do mock (hoisting do vi.mock garante a ordem em runtime).
const { createInternalToolsRouter, ToolHandlerRegistry } = await import('./index');

const TOKEN = 'super-secret-internal-token';
const WS = '11111111-1111-1111-1111-111111111111';
const AGENT = '22222222-2222-2222-2222-222222222222';
const EXEC = '33333333-3333-3333-3333-333333333333';
const CONV = '44444444-4444-4444-4444-444444444444';

function envelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspace_id: WS,
    conversation_id: CONV,
    agent_id: AGENT,
    execution_id: EXEC,
    args: { foo: 'bar' },
    ...over,
  };
}

function makeApp(token: string = TOKEN, registry?: InstanceType<typeof ToolHandlerRegistry>) {
  const app = express();
  app.use(express.json());
  app.use(createInternalToolsRouter({ token, ...(registry ? { registry } : {}) }));
  return app;
}

beforeEach(() => {
  toolLogInserts.length = 0;
  toolCatalog = {};
  lastWorkspaceId = null;
});

describe('POST /internal/tools/:toolKey — auth por token interno', () => {
  it('sem header Authorization → 401', async () => {
    const res = await request(makeApp()).post('/internal/tools/ping').send(envelope());
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('token errado → 401', async () => {
    const res = await request(makeApp())
      .post('/internal/tools/ping')
      .set('Authorization', 'Bearer wrong-token')
      .send(envelope());
    expect(res.status).toBe(401);
  });

  it('token correto → 200 (ping ecoa)', async () => {
    const res = await request(makeApp())
      .post('/internal/tools/ping')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.content).toBe('pong');
    expect(res.body.payload.echo).toEqual({ foo: 'bar' });
    expect(lastWorkspaceId).toBe(WS);
  });

  it('token não configurado (vazio) → 500 fail-closed', async () => {
    const res = await request(makeApp(''))
      .post('/internal/tools/ping')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());
    expect(res.status).toBe(500);
  });
});

describe('POST /internal/tools/:toolKey — dispatch', () => {
  it('tool desconhecida → 404', async () => {
    const res = await request(makeApp())
      .post('/internal/tools/does_not_exist')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('does_not_exist');
  });

  it('envelope inválido (workspace_id não-uuid) → 400', async () => {
    const res = await request(makeApp())
      .post('/internal/tools/ping')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope({ workspace_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('ping não está no catálogo → não grava tool_logs', async () => {
    const res = await request(makeApp())
      .post('/internal/tools/ping')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());
    expect(res.status).toBe(200);
    expect(toolLogInserts).toHaveLength(0);
  });
});

describe('POST /internal/tools/:toolKey — tool_logs', () => {
  it('tool catalogada e bem-sucedida → grava tool_logs (ok, sem erro)', async () => {
    toolCatalog['do_thing'] = 'tool-uuid-1';
    const registry = new ToolHandlerRegistry().register('do_thing', async (env) => ({
      ok: true,
      content: 'done',
      action: 'workflow',
      payload: { handled: env.args },
    }));

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/do_thing')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());

    expect(res.status).toBe(200);
    expect(toolLogInserts).toHaveLength(1);
    const v = toolLogInserts[0]!.values;
    expect(v['workspaceId']).toBe(WS);
    expect(v['toolId']).toBe('tool-uuid-1');
    expect(v['agentId']).toBe(AGENT);
    expect(v['executionId']).toBe(EXEC);
    expect(v['action']).toBe('workflow');
    expect(v['error']).toBeNull();
    expect(typeof v['durationMs']).toBe('number');
  });

  it('handler com ok=false → 422 e tool_logs com erro', async () => {
    toolCatalog['fail_thing'] = 'tool-uuid-2';
    const registry = new ToolHandlerRegistry().register('fail_thing', async () => ({
      ok: false,
      error: 'business rule rejected',
    }));

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/fail_thing')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(toolLogInserts).toHaveLength(1);
    expect(toolLogInserts[0]!.values['error']).toBe('business rule rejected');
    expect(toolLogInserts[0]!.values['result']).toBeNull();
  });

  it('handler que lança → 500 sem vazar stack', async () => {
    toolCatalog['boom'] = 'tool-uuid-3';
    const registry = new ToolHandlerRegistry().register('boom', async () => {
      throw new Error('internal detail with secret');
    });

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/boom')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
