/**
 * F70-S10 — o agente recebe as tools habilitadas no `POST /run`.
 *
 * 1) Puro: deep-merge de `overrides`, contrato `ToolDescriptor`, filtro da policy
 *    (espelho de `filter_tools` do runtime) e montagem do request.
 * 2) Postgres dev: `runAgent` com o `DbAgentRunStore` real e `resolvePolicy` real;
 *    o client do runtime é um fake que captura o request. O agente tem
 *    `transfer_to_human` + `search_knowledge_base` habilitadas, `escalate` desligada,
 *    uma tool inativa e uma tool custom de OUTRO workspace ligada por engano — só as
 *    duas primeiras chegam ao runtime, com o `contact_id` da conversa.
 *
 * As tools globais vêm da migration 0084 (catálogo). Skip automático do bloco de banco
 * sem `DATABASE_URL` (rode com `node --env-file=.env`).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import {
  AgentRunRequestSchema,
  type AgentRunRequest,
  type AgentStreamEvent,
  type PolicySnapshot,
  type ToolDescriptor,
} from '@hm/agents-client';
import type { ResolvedPolicy } from '@hm/agents-core';
import {
  buildRunRequest,
  DbAgentRunStore,
  runAgent,
  type AgentRunContext,
  type AgentRunDeps,
} from './run';
import { deepMerge, filterToolsByPolicy, toToolDescriptors, type AgentToolRow } from './tools';

const url = process.env['DATABASE_URL'];

function tool(key: string, category: string): ToolDescriptor {
  return { key, name: key, description: `${key} desc`, category };
}

function row(key: string, overrides: Partial<AgentToolRow> = {}): AgentToolRow {
  return {
    key,
    name: key,
    description: `${key} desc`,
    category: 'workflow',
    handlerConfig: {},
    overrides: {},
    ...overrides,
  };
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};

// ─── 1) Puro ─────────────────────────────────────────────────────────────────

describe('deepMerge (overrides sobre handler_config)', () => {
  it('mescla objetos em profundidade; array/escalar do override substitui', () => {
    const base = {
      table: 'contacts',
      allowed_columns: { read: ['email', 'phone'], write: [] },
      restricted_columns: ['notes'],
    };
    const merged = deepMerge(base, {
      allowed_columns: { read: ['email'] },
      timeout_ms: 500,
    });
    expect(merged).toEqual({
      table: 'contacts',
      allowed_columns: { read: ['email'], write: [] },
      restricted_columns: ['notes'],
      timeout_ms: 500,
    });
    // Não muta a base.
    expect(base.allowed_columns.read).toEqual(['email', 'phone']);
  });
});

describe('toToolDescriptors', () => {
  it('valida no contrato, omite config vazio e descarta linha inválida', () => {
    const { tools, rejected } = toToolDescriptors([
      row('transfer_to_human'),
      row('query_contact', {
        category: 'database',
        handlerConfig: { table: 'contacts' },
        overrides: { restricted_columns: ['email'] },
      }),
      row('sem_nome', { name: '' }),
      row('transfer_to_human'),
    ]);
    expect(tools).toEqual([
      {
        key: 'transfer_to_human',
        name: 'transfer_to_human',
        description: 'transfer_to_human desc',
        category: 'workflow',
      },
      {
        key: 'query_contact',
        name: 'query_contact',
        description: 'query_contact desc',
        category: 'database',
        config: { table: 'contacts', restricted_columns: ['email'] },
      },
    ]);
    expect(rejected).toEqual(['sem_nome']);
  });
});

describe('filterToolsByPolicy (espelho de filter_tools do runtime)', () => {
  const all = [
    tool('a', 'database'),
    tool('b', 'workflow'),
    tool('c', 'knowledge'),
    tool('d', 'http'),
  ];

  it('categorias vazias = sem restrição; teto corta preservando a ordem', () => {
    expect(
      filterToolsByPolicy(all, { allowed_tool_categories: [], max_tools_per_agent: 2 }).map(
        (t) => t.key,
      ),
    ).toEqual(['a', 'b']);
  });

  it('só passam as categorias permitidas', () => {
    expect(
      filterToolsByPolicy(all, {
        allowed_tool_categories: ['workflow', 'knowledge'],
        max_tools_per_agent: 20,
      }).map((t) => t.key),
    ).toEqual(['b', 'c']);
  });

  it('teto 0 = nenhuma tool; teto negativo = sem teto', () => {
    expect(
      filterToolsByPolicy(all, { allowed_tool_categories: [], max_tools_per_agent: 0 }),
    ).toEqual([]);
    expect(
      filterToolsByPolicy(all, { allowed_tool_categories: [], max_tools_per_agent: -1 }),
    ).toHaveLength(4);
  });
});

describe('buildRunRequest', () => {
  const snapshot: PolicySnapshot = {
    allowed_models: ['openai/gpt-4o-mini'],
    allow_streaming: true,
    allow_interrupts: false,
    allow_parallel_tools: true,
    allow_vision: false,
    allow_transcription: false,
    max_iterations: 5,
    max_tokens_per_call: 8000,
    max_tools_per_agent: 20,
    allowed_tool_categories: ['workflow'],
    remaining_monthly_budget_usd: null,
  };
  const resolved = { snapshot } as unknown as ResolvedPolicy;
  const ctx: AgentRunContext = {
    conversationId: '00000000-0000-0000-0000-0000000000c1',
    chatId: '5511999',
    channelId: 'ch1',
    contactId: '00000000-0000-0000-0000-0000000000f1',
    aiMode: 'on',
    agentId: '00000000-0000-0000-0000-0000000000a1',
    agentStatus: 'active',
    userInput: 'quero falar com alguém',
    history: [],
  };

  it('leva as tools e o contact_id no wire e passa no contrato', () => {
    const req = buildRunRequest('ws', ctx, resolved, [tool('transfer_to_human', 'workflow')]);
    expect(req.tools).toEqual([tool('transfer_to_human', 'workflow')]);
    expect(req.contact_id).toBe(ctx.contactId);
    expect(AgentRunRequestSchema.safeParse(req).success).toBe(true);
  });

  it('leva o agent_executions.id em metadata.execution_id e passa no contrato (F70-S15)', () => {
    const exec = '00000000-0000-0000-0000-0000000000e1';
    const req = buildRunRequest('ws', ctx, resolved, [], exec);
    expect(req.metadata).toEqual({ execution_id: exec });
    // O Zod do cliente preserva `metadata` (o topo descartaria um campo desconhecido).
    expect(AgentRunRequestSchema.parse(req).metadata).toEqual({ execution_id: exec });
    expect(buildRunRequest('ws', ctx, resolved, [])).not.toHaveProperty('metadata');
  });

  it('sem contato não manda contact_id; sem tools manda lista vazia', () => {
    const req = buildRunRequest('ws', { ...ctx, contactId: null }, resolved, []);
    expect(req).not.toHaveProperty('contact_id');
    expect(req.tools).toEqual([]);
  });
});

// ─── 2) Postgres dev ─────────────────────────────────────────────────────────

describe.skipIf(!url)('runAgent entrega as tools habilitadas ao runtime (DB, F70-S10)', () => {
  const WS = randomUUID();
  const OTHER_WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const AGENT = randomUUID();
  const CONV = randomUUID();
  const INACTIVE_TOOL = randomUUID();
  const FOREIGN_TOOL = randomUUID();
  const sfx = WS.slice(0, 8);

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values([
      { id: WS, name: 'F70S10 tools', slug: `f70s10-tl-${sfx}` },
      { id: OTHER_WS, name: 'F70S10 outro', slug: `f70s10-ot-${sfx}` },
    ]);
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S10',
      phoneNumberId: `PN_F70S10_${sfx}`,
      wabaId: `WABA_F70S10_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55119' + sfx.replace(/\D/g, '3').padEnd(8, '3').slice(0, 8),
    });
    await db.insert(schema.agents).values({
      id: AGENT,
      workspaceId: WS,
      name: 'F70S10',
      systemPrompt: 'F70-S10',
      status: 'active',
    });
    await db.insert(schema.conversations).values({
      id: CONV,
      workspaceId: WS,
      channelId: CHANNEL,
      contactId: CONTACT,
      remoteId: `r-${CONV.slice(0, 12)}`,
      aiMode: 'on',
      agentId: AGENT,
    });
    await db.insert(schema.messages).values({
      workspaceId: WS,
      conversationId: CONV,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: 'quero falar com uma pessoa',
    });

    // Tool inativa (do workspace) e tool custom de OUTRO workspace: nunca devem chegar.
    await db.insert(schema.tools).values([
      {
        id: INACTIVE_TOOL,
        workspaceId: WS,
        key: `inativa_${sfx}`,
        name: 'Inativa',
        description: 'desligada no catálogo',
        category: 'workflow',
        schema: {},
        isActive: false,
      },
      {
        id: FOREIGN_TOOL,
        workspaceId: OTHER_WS,
        key: `alheia_${sfx}`,
        name: 'Alheia',
        description: 'de outro workspace',
        category: 'workflow',
        schema: {},
      },
    ]);

    const globals = await db
      .select({ id: schema.tools.id, key: schema.tools.key })
      .from(schema.tools)
      .where(
        and(
          inArray(schema.tools.key, ['transfer_to_human', 'search_knowledge_base', 'escalate']),
          isNull(schema.tools.workspaceId),
        ),
      );
    const id = (key: string): string => {
      const found = globals.find((g) => g.key === key);
      if (!found) throw new Error(`tool global ${key} ausente`);
      return found.id;
    };
    await db.insert(schema.agentTools).values([
      { agentId: AGENT, toolId: id('transfer_to_human'), isEnabled: true },
      { agentId: AGENT, toolId: id('search_knowledge_base'), isEnabled: true },
      { agentId: AGENT, toolId: id('escalate'), isEnabled: false },
      { agentId: AGENT, toolId: INACTIVE_TOOL, isEnabled: true },
      { agentId: AGENT, toolId: FOREIGN_TOOL, isEnabled: true },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [WS, OTHER_WS]));
    await closeDb();
  });

  it('o request do runtime traz só as tools habilitadas, ativas e do escopo', async () => {
    const captured: AgentRunRequest[] = [];
    async function* fakeRuntime(
      req: AgentRunRequest,
    ): AsyncGenerator<AgentStreamEvent, void, unknown> {
      captured.push(req);
      yield {
        type: 'final',
        reply: 'Vou te passar para a equipe.',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, total_cost_usd: 0 },
        openrouter_generation_id: null,
      };
    }
    const deps: AgentRunDeps = {
      store: new DbAgentRunStore(),
      socket: { emitStarted: vi.fn(async () => {}), emitCompleted: vi.fn(async () => {}) },
      client: {
        run: fakeRuntime,
        health: vi.fn(),
        cancel: vi.fn(),
      } as unknown as AgentRunDeps['client'],
      outbound: { enqueueText: vi.fn(async () => {}) },
      logger: logger as unknown as AgentRunDeps['logger'],
    };

    const outcome = await runAgent(
      WS,
      { conversationId: CONV, contactId: CONTACT, channelId: CHANNEL, provider: 'meta_whatsapp' },
      deps,
    );

    expect(outcome.status).toBe('replied');
    expect(captured).toHaveLength(1);
    const req = AgentRunRequestSchema.parse(captured[0]);
    // F70-S15: o runtime recebe o id da linha de agent_executions criada pelo worker.
    if (outcome.status !== 'replied') throw new Error('unreachable');
    expect(req.metadata).toEqual({ execution_id: outcome.executionId });
    const [exec] = await getDb()
      .select({ agentId: schema.agentExecutions.agentId })
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.id, outcome.executionId));
    expect(exec?.agentId).toBe(AGENT);
    // Ordem estável (categoria, key): knowledge < workflow.
    expect(req.tools.map((t) => t.key)).toEqual(['search_knowledge_base', 'transfer_to_human']);
    expect(req.tools[1]).toMatchObject({
      key: 'transfer_to_human',
      name: 'Transferir para humano',
      category: 'workflow',
    });
    expect(req.contact_id).toBe(CONTACT);
    expect(req.conversation_id).toBe(CONV);
  });

  it('agente sem nenhuma agent_tools recebe lista vazia (comportamento anterior)', async () => {
    const lonely = randomUUID();
    await getDb().insert(schema.agents).values({
      id: lonely,
      workspaceId: WS,
      name: 'Sem tools',
      systemPrompt: 'x',
      status: 'active',
    });
    const loaded = await new DbAgentRunStore().loadTools(WS, lonely);
    expect(loaded).toEqual({ tools: [], rejected: [] });
  });
});
