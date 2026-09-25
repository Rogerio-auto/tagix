/**
 * Testes do endpoint interno de tools (callback Python → Node) — F2-S07 / F70-S15.
 *
 * `@hm/db` é mockado: `withWorkspace` apenas executa o callback com um `tx` fake que
 * captura os inserts em `tool_logs` (e responde vazio às leituras da recusa). A
 * barreira de habilitação é injetada (`authorize`): permite só as keys de
 * `toolCatalog`. Sem Postgres real — a barreira contra o banco é coberta em
 * `access.integration.test.ts`. Cobre: token (401/500), tool desconhecida (404),
 * envelope inválido (400), recusa (403, nada executa, recusa logada), `tool_logs`.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCallAuthorizer } from './access';
import { EMPTY_TOOL_CONTEXT } from './registry';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

interface LogCapture {
  values: Record<string, unknown>;
}
const toolLogInserts: LogCapture[] = [];

/** key → id de `tools` habilitada. Fora daqui = recusa. */
let toolCatalog: Record<string, string> = {};
/** key → id de `tools` que existe mas NÃO está habilitada (recusa com log). */
let disabledCatalog: Record<string, string> = {};
let lastWorkspaceId: string | null = null;

function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        toolLogInserts.push({ values });
      },
    }),
  };
}

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  asc: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  or: () => ({}),
}));

vi.mock('@hm/db', () => ({
  withWorkspace: async (id: string, fn: (tx: unknown) => Promise<unknown>) => {
    lastWorkspaceId = id;
    return fn(makeTx());
  },
  schema: {
    agents: { id: 'id' },
    conversations: { id: 'id' },
    tools: { id: 'id', key: 'key' },
    toolLogs: {},
  },
}));

const fakeAuthorize: ToolCallAuthorizer = async (_tx, toolKey) => {
  const enabled = toolCatalog[toolKey];
  if (enabled) return { allowed: true, toolId: enabled, toolConfig: EMPTY_TOOL_CONTEXT.toolConfig };
  const disabled = disabledCatalog[toolKey];
  return disabled
    ? { allowed: false, reason: 'tool_not_enabled', toolId: disabled }
    : { allowed: false, reason: 'tool_not_found', toolId: null };
};

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};

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
  app.use(
    createInternalToolsRouter({
      token,
      authorize: fakeAuthorize,
      logger: silentLogger,
      ...(registry ? { registry } : {}),
    }),
  );
  return app;
}

beforeEach(() => {
  toolLogInserts.length = 0;
  // `ping` habilitada por padrão: os testes de transporte não dependem da barreira.
  toolCatalog = { ping: 'tool-ping' };
  disabledCatalog = {};
  lastWorkspaceId = null;
  vi.clearAllMocks();
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

  it('ping habilitada → 200 e tool_logs aponta para a linha resolvida pela barreira', async () => {
    const res = await request(makeApp())
      .post('/internal/tools/ping')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());
    expect(res.status).toBe(200);
    expect(toolLogInserts).toHaveLength(1);
    expect(toolLogInserts[0]!.values['toolId']).toBe('tool-ping');
  });
});

describe('POST /internal/tools/:toolKey — barreira de habilitação (F70-S15)', () => {
  it('tool não habilitada → 403, handler não roda, recusa em tool_logs e no log', async () => {
    disabledCatalog['do_thing'] = 'tool-disabled';
    const handler = vi.fn(async () => ({ ok: true, content: 'não devia rodar' }));
    const registry = new ToolHandlerRegistry().register('do_thing', handler);

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/do_thing')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(toolLogInserts).toHaveLength(1);
    const v = toolLogInserts[0]!.values;
    expect(v['toolId']).toBe('tool-disabled');
    expect(v['action']).toBe('denied');
    expect(v['error']).toBe('tool_not_enabled');
    expect(v['executionId']).toBe(EXEC);
    // Args do modelo não entram na recusa; agente/conversa não visíveis sob RLS → null.
    expect(v['params']).toEqual({ tool: 'do_thing' });
    expect(v['agentId']).toBeNull();
    expect(v['conversationId']).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(
      'internal-tools: chamada recusada',
      expect.objectContaining({ toolKey: 'do_thing', reason: 'tool_not_enabled' }),
    );
  });

  it('tool fora do catálogo do workspace → 403 sem linha em tool_logs (FK exige tool)', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const registry = new ToolHandlerRegistry().register('ghost', handler);

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/ghost')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(toolLogInserts).toHaveLength(0);
    expect(silentLogger.warn).toHaveBeenCalledWith(
      'internal-tools: chamada recusada',
      expect.objectContaining({ toolKey: 'ghost', reason: 'tool_not_found' }),
    );
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

  it('texto livre do modelo vai ao log mascarado e truncado (L8)', async () => {
    toolCatalog['escalate'] = 'tool-uuid-9';
    const registry = new ToolHandlerRegistry().register('escalate', async () => ({
      ok: true,
      content: 'ok',
    }));

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/escalate')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(
        envelope({
          args: {
            reason: `Maria, CPF 123.456.789-00, maria@x.com, fone 11 99999-0000 ${'x'.repeat(200)}`,
            severity: 'high',
            stage_id: '11111111-1111-1111-1111-111111111111',
          },
        }),
      );

    expect(res.status).toBe(200);
    const params = toolLogInserts[0]!.values['params'] as Record<string, string>;
    expect(params['reason']).not.toMatch(/\d/);
    expect(params['reason']).not.toContain('maria@x.com');
    expect(params['reason']).toContain('[email]');
    expect(params['reason']!.length).toBeLessThanOrEqual(121);
    // O que a política da tool declara fica (enum); o que ela não conhece é mascarado.
    expect(params['severity']).toBe('high');
    expect(params['stage_id']).toBe('[redacted:string]');
  });

  it('update_contact: tool_logs.params sem display_name nem valores de custom_fields (L-b)', async () => {
    toolCatalog['update_contact'] = 'tool-uuid-10';
    const registry = new ToolHandlerRegistry().register('update_contact', async (env) => ({
      ok: true,
      content: 'ok',
      payload: { updated: ['display_name', 'custom_fields'], echo: env.args },
    }));

    const res = await request(makeApp(TOKEN, registry))
      .post('/internal/tools/update_contact')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(
        envelope({
          args: {
            display_name: 'Maria Souza',
            language: 'pt-BR',
            custom_fields: { cpf: '123.456.789-00', endereco: { rua: 'Rua A, 10' }, vip: true },
          },
        }),
      );

    expect(res.status).toBe(200);
    const v = toolLogInserts[0]!.values;
    const logged = JSON.stringify([v['params'], v['result']]);
    for (const secret of ['Maria', 'Souza', '123.456.789-00', 'Rua A']) {
      expect(logged).not.toContain(secret);
    }
    expect(v['params']).toEqual({
      display_name: '[redacted:string]',
      language: 'pt-BR',
      custom_fields: {
        cpf: '[redacted:string]',
        endereco: { rua: '[redacted:string]' },
        vip: '[redacted:boolean]',
      },
    });
    // O resultado segue a política dele: `updated` fica; o eco dos args, não.
    expect((v['result'] as Record<string, unknown>)['updated']).toEqual([
      'display_name',
      'custom_fields',
    ]);
  });

  it('tool sem política declarada: args e resultado inteiramente mascarados', async () => {
    toolCatalog['do_thing'] = 'tool-uuid-11';
    const registry = new ToolHandlerRegistry().register('do_thing', async () => ({
      ok: true,
      payload: { name: 'Maria', n: 5 },
    }));

    await request(makeApp(TOKEN, registry))
      .post('/internal/tools/do_thing')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope({ args: { name: 'Maria', phone: '+5511999990000' } }));

    const v = toolLogInserts[0]!.values;
    expect(v['params']).toEqual({ name: '[redacted:string]', phone: '[redacted:string]' });
    expect(v['result']).toEqual({ name: '[redacted:string]', n: '[redacted:number]' });
  });

  it('a config que a barreira leu chega ao handler (nunca a do request)', async () => {
    const seen: unknown[] = [];
    const registry = new ToolHandlerRegistry().register('cfg_thing', async (_env, _tx, ctx) => {
      seen.push(ctx.toolConfig);
      return { ok: true, content: 'ok' };
    });
    const toolConfig = { base: { allowed_tags: ['a'] }, overrides: { allowed_tags: ['a'] } };
    const app = express();
    app.use(express.json());
    app.use(
      createInternalToolsRouter({
        registry,
        token: TOKEN,
        authorize: async () => ({ allowed: true, toolId: 'tool-uuid-12', toolConfig }),
      }),
    );

    const res = await request(app)
      .post('/internal/tools/cfg_thing')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope({ args: { tool_config: { allowed_tags: ['tudo'] } } }));

    expect(res.status).toBe(200);
    expect(seen).toEqual([toolConfig]);
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

  it('erro do handler vai ao log sem dígitos nem e-mail', async () => {
    toolCatalog['fail_pii'] = 'tool-uuid-13';
    const registry = new ToolHandlerRegistry().register('fail_pii', async () => ({
      ok: false,
      error: "Tipo de conversão 'cpf 12345678900 ana@x.com' não existe.",
    }));

    await request(makeApp(TOKEN, registry))
      .post('/internal/tools/fail_pii')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(envelope());

    expect(toolLogInserts[0]!.values['error']).toBe(
      "Tipo de conversão 'cpf ########### [email] não existe.",
    );
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
