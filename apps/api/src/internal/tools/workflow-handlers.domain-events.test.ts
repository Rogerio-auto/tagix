/**
 * F70-S09 — eventos de domínio das tools da IA, pelo endpoint interno real
 * (`POST /internal/tools/:toolKey`) contra o Postgres dev (RLS real).
 *
 * Prova:
 *  - `transfer_to_human` publica `conversation.handoff` DEPOIS do commit, com o
 *    payload mínimo (sem o `reason` escrito pelo modelo) e ocorrência = execução.
 *  - `mark_resolved` publica `conversation.resolved` (autor = agente).
 *  - tool que falha (conversa inexistente) não publica nada.
 *  - a auditoria em `tool_logs` é best-effort de verdade: uma falha no INSERT do log
 *    (FK violada) não desfaz a ação nem vira 500.
 *
 * O transporte do emissor é trocado por um coletor (sem RabbitMQ). Skip automático
 * se o Postgres dev não estiver acessível.
 *
 * F70-S15: o endpoint só executa tool habilitada para o agente, numa execução em
 * curso dele — o setup cria o agente, habilita as tools e abre uma execução por chamada.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { setDomainEventTransport, type Envelope } from '@hm/shared/mq';
import { createInternalToolsRouter } from './router';
import { buildWorkflowRegistry } from './workflow-handlers';

const TOKEN = 'test-runtime-token-f70s09';
const WS = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();
const AGENT_ID = randomUUID();

let dbAvailable = true;
const published: Array<{ rk: string; env: Envelope }> = [];

const app = express();
app.use(express.json());
app.use(createInternalToolsRouter({ registry: buildWorkflowRegistry(), token: TOKEN }));

/**
 * App cuja barreira libera a chamada apontando para um `tools.id` inexistente: a ação
 * roda e commita, e o INSERT do log viola a FK `tool_id` (23503). Depois da F70-S15 é
 * o jeito determinístico de quebrar SÓ a auditoria — agente, execução e conversa já
 * são garantidos pela barreira real.
 */
const appWithBrokenAudit = express();
appWithBrokenAudit.use(express.json());
appWithBrokenAudit.use(
  createInternalToolsRouter({
    registry: buildWorkflowRegistry(),
    token: TOKEN,
    authorize: async () => ({ allowed: true, toolId: randomUUID() }),
  }),
);

/** Execução `running` do agente na conversa (o que o worker cria antes do /run). */
async function freshExecution(conversationId: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.agentExecutions)
    .values({
      workspaceId: WS,
      agentId: AGENT_ID,
      conversationId,
      threadId: conversationId,
      status: 'running',
      state: {},
    })
    .returning({ id: schema.agentExecutions.id });
  if (!row) throw new Error('execução não criada');
  return row.id;
}

async function freshConversation(): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.conversations)
    .values({
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

function callTool(
  toolKey: string,
  conversationId: string,
  executionId: string,
  args: Record<string, unknown>,
  target: express.Express = app,
) {
  return request(target)
    .post(`/internal/tools/${toolKey}`)
    .set('authorization', `Bearer ${TOKEN}`)
    .send({
      workspace_id: WS,
      conversation_id: conversationId,
      agent_id: AGENT_ID,
      execution_id: executionId,
      args,
    });
}

beforeAll(async () => {
  setDomainEventTransport(async (rk, env) => {
    published.push({ rk, env });
  });
  try {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'F70S09 tools', slug: `f70s09-${WS.slice(0, 8)}` });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      displayName: 'Lead F70',
      phone: `+55119${WS.slice(0, 8)}`,
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal F70',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
    await db
      .insert(schema.agents)
      .values({ id: AGENT_ID, workspaceId: WS, name: 'Agente F70', systemPrompt: 'F70-S09' });
    // Tools do próprio workspace (somem com ele no cascade), habilitadas no agente.
    const toolRows = await db
      .insert(schema.tools)
      .values(
        ['transfer_to_human', 'mark_resolved'].map((key) => ({
          workspaceId: WS,
          key,
          name: key,
          description: key,
          category: 'workflow',
          schema: {},
        })),
      )
      .returning({ id: schema.tools.id });
    await db
      .insert(schema.agentTools)
      .values(toolRows.map((t) => ({ agentId: AGENT_ID, toolId: t.id })));
  } catch (err) {
    dbAvailable = false;
    console.warn('[F70-S09 tools] Postgres dev indisponível — testes pulados.', err);
  }
});

afterEach(() => {
  published.length = 0;
});

afterAll(async () => {
  setDomainEventTransport(null);
  if (dbAvailable) {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  }
  await closeDb();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

describe('F70-S09 — eventos de domínio das tools da IA', () => {
  maybe('transfer_to_human publica conversation.handoff mínimo, depois do commit', async () => {
    const conv = await freshConversation();
    const executionId = await freshExecution(conv);

    const res = await callTool('transfer_to_human', conv, executionId, {
      reason: 'Cliente Maria (CPF 123.456.789-00) quer falar com humano',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(published).toHaveLength(1);
    const evt = published[0];
    expect(evt?.rk).toBe('domain.conversation.handoff');
    expect(evt?.env.type).toBe('conversation.handoff');
    expect(evt?.env.workspaceId).toBe(WS);
    const payload = evt?.env.payload as { eventId: string; data: Record<string, unknown> };
    expect(payload.eventId).toBe(`${conv}:handoff:${executionId}`);
    expect(payload.data).toEqual({ conversationId: conv, agentId: AGENT_ID, departmentId: null });
    // O texto do modelo não sai em lugar nenhum do evento.
    expect(JSON.stringify(evt?.env)).not.toContain('CPF');

    // O evento reflete estado JÁ commitado: a conversa está com humano.
    const [row] = await getDb()
      .select({ aiMode: schema.conversations.aiMode, status: schema.conversations.status })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conv));
    expect(row).toEqual({ aiMode: 'off', status: 'pending' });

    // A trilha de auditoria foi gravada (transação própria, depois da ação).
    const logs = await getDb()
      .select({ action: schema.toolLogs.action, error: schema.toolLogs.error })
      .from(schema.toolLogs)
      .where(
        and(eq(schema.toolLogs.workspaceId, WS), eq(schema.toolLogs.executionId, executionId)),
      );
    expect(logs).toEqual([{ action: 'transfer_to_human', error: null }]);
  });

  maybe('mark_resolved publica conversation.resolved com autor agente', async () => {
    const conv = await freshConversation();
    const res = await callTool('mark_resolved', conv, await freshExecution(conv), {
      resolution: 'ok',
    });
    expect(res.status).toBe(200);

    expect(published).toHaveLength(1);
    const payload = published[0]?.env.payload as { data: Record<string, unknown> };
    expect(published[0]?.env.type).toBe('conversation.resolved');
    expect(payload.data).toEqual({
      conversationId: conv,
      resolvedBy: 'agent',
      memberId: null,
      agentId: AGENT_ID,
    });
  });

  maybe('tool que falha não publica evento', async () => {
    const conv = await freshConversation();
    // Args inválidos: o handler recusa (422) depois de passar pela barreira.
    const res = await callTool('transfer_to_human', conv, await freshExecution(conv), {
      reason: '',
    });
    expect(res.status).toBe(422);
    expect(published).toHaveLength(0);
  });

  maybe('falha ao gravar tool_logs não desfaz a ação nem vira 500', async () => {
    const conv = await freshConversation();
    const executionId = await freshExecution(conv);
    // `tool_id` inexistente → o INSERT do log viola a FK (23503), já fora da ação.
    const res = await callTool(
      'mark_resolved',
      conv,
      executionId,
      { resolution: 'ok' },
      appWithBrokenAudit,
    );
    expect(res.status).toBe(200);
    expect(published).toHaveLength(1);

    const [row] = await getDb()
      .select({ status: schema.conversations.status })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conv));
    expect(row?.status).toBe('resolved');

    const logs = await getDb()
      .select({ id: schema.toolLogs.id })
      .from(schema.toolLogs)
      .where(eq(schema.toolLogs.executionId, executionId));
    expect(logs).toHaveLength(0);
  });
});
