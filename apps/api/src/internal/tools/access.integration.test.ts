/**
 * F70-S15 — barreira de habilitação + tools de contato, pelo endpoint interno real
 * (`POST /internal/tools/:toolKey`) e o registry de produção, contra o Postgres dev
 * (RLS real).
 *
 * Prova:
 *  - tool não habilitada para o agente → 403, nada executa, recusa em `tool_logs`;
 *  - execução de outro agente / outra conversa / já encerrada → 403;
 *  - envelope apontando para outro workspace → 403 (o agente não existe lá);
 *  - tool custom de OUTRO workspace com a mesma key não é usada nem logada (nem
 *    vinculada por engano ao agente via `agent_tools`);
 *  - `add_contact_tag` aplica etiqueta existente (idempotente) e não cria etiqueta;
 *  - `update_contact` edita só a allowlist e recusa telefone/e-mail/opt-in sem escrever.
 *
 * Skip automático se o Postgres dev não estiver acessível.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { setDomainEventTransport } from '@hm/shared/mq';
import { createInternalToolsRouter } from './router';
import { buildWorkflowRegistry } from './workflow-handlers';

const TOKEN = 'test-runtime-token-f70s15';
const WS = randomUUID();
const WS_OTHER = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();
const AGENT = randomUUID();
const AGENT_PEER = randomUUID();
const AGENT_OTHER_WS = randomUUID();
const TAG_HUMAN = randomUUID();

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child() {
    return silentLogger;
  },
};

const app = express();
app.use(express.json());
app.use(
  createInternalToolsRouter({
    registry: buildWorkflowRegistry(),
    token: TOKEN,
    logger: silentLogger,
  }),
);

let dbAvailable = true;
/** key → id da tool GLOBAL usada nos testes. */
const globalTool: Record<string, string> = {};
/** id da tool custom de WS_OTHER com key `mark_resolved`. */
let otherWsMarkResolved = '';
/** id da tool custom de WS_OTHER com key `escalate` (vinculada por engano ao AGENT). */
let otherWsEscalate = '';

/** Garante a tool global (a 0084 já a cria; aqui só cobre um banco sem a migration). */
async function ensureGlobalTool(key: string): Promise<string> {
  const db = getDb();
  const [found] = await db
    .select({ id: schema.tools.id })
    .from(schema.tools)
    .where(and(eq(schema.tools.key, key), isNull(schema.tools.workspaceId)))
    .limit(1);
  if (found) return found.id;
  const [created] = await db
    .insert(schema.tools)
    .values({
      workspaceId: null,
      key,
      name: key,
      description: key,
      category: 'workflow',
      schema: {},
      isGlobal: true,
    })
    .returning({ id: schema.tools.id });
  if (!created) throw new Error(`tool global ${key} não criada`);
  return created.id;
}

async function customTool(workspaceId: string, key: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.tools)
    .values({ workspaceId, key, name: key, description: key, category: 'workflow', schema: {} })
    .returning({ id: schema.tools.id });
  if (!row) throw new Error(`tool custom ${key} não criada`);
  return row.id;
}

async function freshConversation(): Promise<string> {
  const id = randomUUID();
  await getDb().insert(schema.conversations).values({
    id,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: `r-${id.slice(0, 12)}`,
    aiMode: 'on',
    status: 'open',
  });
  return id;
}

async function freshExecution(
  conversationId: string,
  opts: { agentId?: string; status?: string } = {},
): Promise<string> {
  const [row] = await getDb()
    .insert(schema.agentExecutions)
    .values({
      workspaceId: WS,
      agentId: opts.agentId ?? AGENT,
      conversationId,
      threadId: conversationId,
      status: opts.status ?? 'running',
      state: {},
    })
    .returning({ id: schema.agentExecutions.id });
  if (!row) throw new Error('execução não criada');
  return row.id;
}

function callTool(
  toolKey: string,
  body: {
    conversationId: string;
    executionId: string;
    args?: Record<string, unknown>;
    workspaceId?: string;
    agentId?: string;
  },
) {
  return request(app)
    .post(`/internal/tools/${toolKey}`)
    .set('authorization', `Bearer ${TOKEN}`)
    .send({
      workspace_id: body.workspaceId ?? WS,
      conversation_id: body.conversationId,
      agent_id: body.agentId ?? AGENT,
      execution_id: body.executionId,
      args: body.args ?? {},
    });
}

async function logsOf(executionId: string) {
  return getDb()
    .select({
      toolId: schema.toolLogs.toolId,
      workspaceId: schema.toolLogs.workspaceId,
      action: schema.toolLogs.action,
      error: schema.toolLogs.error,
      params: schema.toolLogs.params,
    })
    .from(schema.toolLogs)
    .where(eq(schema.toolLogs.executionId, executionId));
}

async function conversationStatus(id: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: schema.conversations.status })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id));
  return row?.status;
}

async function contactRow() {
  const [row] = await getDb()
    .select({
      displayName: schema.contacts.displayName,
      phone: schema.contacts.phone,
      email: schema.contacts.email,
      language: schema.contacts.language,
      timezone: schema.contacts.timezone,
      marketingOptIn: schema.contacts.marketingOptIn,
      customFields: schema.contacts.customFields,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, CONTACT));
  if (!row) throw new Error('contato sumiu');
  return row;
}

beforeAll(async () => {
  setDomainEventTransport(async () => undefined);
  try {
    const db = getDb();
    await db.insert(schema.workspaces).values([
      { id: WS, name: 'F70S15 tools', slug: `f70s15-${WS.slice(0, 8)}` },
      { id: WS_OTHER, name: 'F70S15 outro', slug: `f70s15o-${WS_OTHER.slice(0, 8)}` },
    ]);
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      displayName: 'Lead F70-S15',
      phone: `+55119${WS.slice(0, 8)}`,
      email: `lead-${WS.slice(0, 8)}@x.test`,
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal F70-S15',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
    await db.insert(schema.agents).values([
      { id: AGENT, workspaceId: WS, name: 'Agente', systemPrompt: 'F70-S15' },
      { id: AGENT_PEER, workspaceId: WS, name: 'Par', systemPrompt: 'F70-S15' },
      { id: AGENT_OTHER_WS, workspaceId: WS_OTHER, name: 'Outro', systemPrompt: 'F70-S15' },
    ]);
    await db
      .insert(schema.tags)
      .values({ id: TAG_HUMAN, workspaceId: WS, name: 'atendimento-humano' });

    for (const key of ['mark_resolved', 'escalate', 'transfer_to_human']) {
      globalTool[key] = await ensureGlobalTool(key);
    }
    // Contato: tools do próprio workspace (somem no cascade) — o catálogo global delas
    // chega pela 0087/seed, que este teste não aplica no banco compartilhado.
    const addTag = await customTool(WS, 'add_contact_tag');
    const updContact = await customTool(WS, 'update_contact');
    otherWsMarkResolved = await customTool(WS_OTHER, 'mark_resolved');
    otherWsEscalate = await customTool(WS_OTHER, 'escalate');

    const link = (agentId: string, toolId: string, isEnabled = true) => ({
      agentId,
      toolId,
      isEnabled,
    });
    await db.insert(schema.agentTools).values([
      link(AGENT, globalTool['mark_resolved']!),
      link(AGENT, globalTool['transfer_to_human']!, false),
      link(AGENT, addTag),
      link(AGENT, updContact),
      // Vínculo torto: o agente de WS aponta para a custom `escalate` de WS_OTHER.
      link(AGENT, otherWsEscalate),
      link(AGENT_OTHER_WS, otherWsMarkResolved),
    ]);
  } catch (err) {
    dbAvailable = false;
    console.warn('[F70-S15 tools] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  setDomainEventTransport(null);
  if (dbAvailable) {
    await getDb()
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, WS));
    await getDb()
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, WS_OTHER));
  }
  await closeDb();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  }, 30_000);

describe('F70-S15 — barreira de habilitação do endpoint interno', () => {
  maybe('tool desabilitada no agente → 403, nada executa, recusa registrada', async () => {
    const conv = await freshConversation();
    const exec = await freshExecution(conv);

    const res = await callTool('transfer_to_human', {
      conversationId: conv,
      executionId: exec,
      args: { reason: 'quero humano' },
    });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(await conversationStatus(conv)).toBe('open');
    const logs = await logsOf(exec);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      toolId: globalTool['transfer_to_human'],
      workspaceId: WS,
      action: 'denied',
      error: 'tool_not_enabled',
      params: { tool: 'transfer_to_human' },
    });
  });

  maybe('tool habilitada → executa e loga a linha global certa', async () => {
    const conv = await freshConversation();
    const exec = await freshExecution(conv);

    const res = await callTool('mark_resolved', {
      conversationId: conv,
      executionId: exec,
      args: { resolution: 'resolvido' },
    });

    expect(res.status).toBe(200);
    expect(await conversationStatus(conv)).toBe('resolved');
    const logs = await logsOf(exec);
    expect(logs).toHaveLength(1);
    // Nunca a custom `mark_resolved` de WS_OTHER, que tem a mesma key.
    expect(logs[0]?.toolId).toBe(globalTool['mark_resolved']);
    expect(logs[0]?.toolId).not.toBe(otherWsMarkResolved);
    expect(logs[0]?.action).toBe('mark_resolved');
  });

  maybe('custom de outro workspace vinculada por engano não habilita a key', async () => {
    const conv = await freshConversation();
    const exec = await freshExecution(conv);

    const res = await callTool('escalate', {
      conversationId: conv,
      executionId: exec,
      args: { reason: 'cliente irritado' },
    });

    expect(res.status).toBe(403);
    const logs = await logsOf(exec);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.toolId).toBe(globalTool['escalate']);
    expect(logs[0]?.toolId).not.toBe(otherWsEscalate);
    expect(logs[0]?.error).toBe('tool_not_enabled');
  });

  maybe('execução de outro agente, de outra conversa ou encerrada → 403', async () => {
    const conv = await freshConversation();
    const otherConv = await freshConversation();

    const peerExec = await freshExecution(conv, { agentId: AGENT_PEER });
    const r1 = await callTool('mark_resolved', {
      conversationId: conv,
      executionId: peerExec,
      args: { resolution: 'x' },
    });
    expect(r1.status).toBe(403);
    expect((await logsOf(peerExec))[0]?.error).toBe('execution_mismatch');

    const otherConvExec = await freshExecution(otherConv);
    const r2 = await callTool('mark_resolved', {
      conversationId: conv,
      executionId: otherConvExec,
      args: { resolution: 'x' },
    });
    expect(r2.status).toBe(403);

    const doneExec = await freshExecution(conv, { status: 'completed' });
    const r3 = await callTool('mark_resolved', {
      conversationId: conv,
      executionId: doneExec,
      args: { resolution: 'x' },
    });
    expect(r3.status).toBe(403);
    expect((await logsOf(doneExec))[0]?.error).toBe('execution_not_running');

    const r4 = await callTool('mark_resolved', {
      conversationId: conv,
      executionId: randomUUID(),
      args: { resolution: 'x' },
    });
    expect(r4.status).toBe(403);

    expect(await conversationStatus(conv)).toBe('open');
    expect(await conversationStatus(otherConv)).toBe('open');
  });

  maybe('envelope com o workspace de outro tenant → 403, nada logado lá', async () => {
    const conv = await freshConversation();
    const exec = await freshExecution(conv);

    // O agente de WS pede para rodar no escopo de WS_OTHER (onde há `mark_resolved`).
    const res = await callTool('mark_resolved', {
      workspaceId: WS_OTHER,
      conversationId: conv,
      executionId: exec,
      args: { resolution: 'x' },
    });

    expect(res.status).toBe(403);
    expect(await conversationStatus(conv)).toBe('open');
    const logs = await logsOf(exec);
    // A recusa fica no escopo de WS_OTHER, sem apontar agente/conversa de WS.
    for (const l of logs) expect(l.workspaceId).toBe(WS_OTHER);
  });
});

describe('F70-S15 — tools de contato', () => {
  maybe('add_contact_tag aplica etiqueta existente, idempotente', async () => {
    const conv = await freshConversation();

    const r1 = await callTool('add_contact_tag', {
      conversationId: conv,
      executionId: await freshExecution(conv),
      args: { tag: 'atendimento-humano' },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);

    const r2 = await callTool('add_contact_tag', {
      conversationId: conv,
      executionId: await freshExecution(conv),
      args: { tag: 'Atendimento-Humano' },
    });
    expect(r2.status).toBe(200);
    expect(r2.body.payload).toMatchObject({ tagId: TAG_HUMAN, applied: false });

    const rows = await getDb()
      .select({ tagId: schema.contactTags.tagId })
      .from(schema.contactTags)
      .where(eq(schema.contactTags.contactId, CONTACT));
    expect(rows).toEqual([{ tagId: TAG_HUMAN }]);
  });

  maybe('add_contact_tag não cria etiqueta nem aceita args extras', async () => {
    const conv = await freshConversation();

    const res = await callTool('add_contact_tag', {
      conversationId: conv,
      executionId: await freshExecution(conv),
      args: { tag: 'vip-inventada' },
    });
    expect(res.status).toBe(422);
    const created = await getDb()
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.workspaceId, WS), eq(schema.tags.name, 'vip-inventada')));
    expect(created).toHaveLength(0);

    const extra = await callTool('add_contact_tag', {
      conversationId: conv,
      executionId: await freshExecution(conv),
      args: { tag: 'atendimento-humano', contact_id: randomUUID() },
    });
    expect(extra.status).toBe(422);
  });

  maybe('update_contact recusa campo fora da allowlist sem escrever nada', async () => {
    const conv = await freshConversation();
    const before = await contactRow();

    for (const args of [
      { phone: '+5511999999999' },
      { email: 'novo@x.test' },
      { display_name: 'Nome Novo', marketing_opt_in: true },
      { owner_id: randomUUID() },
      { workspace_id: WS_OTHER },
    ]) {
      const res = await callTool('update_contact', {
        conversationId: conv,
        executionId: await freshExecution(conv),
        args,
      });
      expect(res.status, JSON.stringify(Object.keys(args))).toBe(422);
      expect(res.body.error).toContain('não editável');
    }

    expect(await contactRow()).toEqual(before);
  });

  maybe('update_contact edita a allowlist e faz merge dos campos personalizados', async () => {
    const conv = await freshConversation();
    const exec1 = await freshExecution(conv);

    const r1 = await callTool('update_contact', {
      conversationId: conv,
      executionId: exec1,
      args: {
        display_name: 'Maria Souza',
        language: 'es',
        timezone: 'America/Sao_Paulo',
        custom_fields: { interesse: 'plano anual', leads: 3 },
      },
    });
    expect(r1.status).toBe(200);

    const r2 = await callTool('update_contact', {
      conversationId: conv,
      executionId: await freshExecution(conv),
      args: { custom_fields: { cidade: 'Campinas' } },
    });
    expect(r2.status).toBe(200);

    const bad = await callTool('update_contact', {
      conversationId: conv,
      executionId: await freshExecution(conv),
      args: { timezone: 'Marte/Olympus' },
    });
    expect(bad.status).toBe(422);

    const after = await contactRow();
    expect(after).toMatchObject({
      displayName: 'Maria Souza',
      language: 'es',
      timezone: 'America/Sao_Paulo',
      phone: `+55119${WS.slice(0, 8)}`,
      marketingOptIn: false,
    });
    expect(after.customFields).toEqual({ interesse: 'plano anual', leads: 3, cidade: 'Campinas' });

    const logs = await logsOf(exec1);
    expect(logs[0]).toMatchObject({ action: 'update_contact', error: null });
  });
});
