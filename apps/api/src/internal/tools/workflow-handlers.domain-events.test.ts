/**
 * F70-S09/S17 — eventos de domínio das tools da IA, pelo endpoint interno real
 * (`POST /internal/tools/:toolKey`) contra o Postgres dev (RLS real).
 *
 * Prova:
 *  - `transfer_to_human` grava `conversation.handoff` na outbox, na transação da
 *    ação, com o payload mínimo (sem o `reason` escrito pelo modelo) e ocorrência =
 *    execução.
 *  - `mark_resolved` grava `conversation.resolved` (autor = agente), com ocorrência =
 *    execução: repetir a tool na mesma execução grava UM evento (F70-S20); outra
 *    execução grava outro.
 *  - tool que falha (args inválidos) não grava nada.
 *  - rollback forçado depois da ação e do enqueue, antes do COMMIT: nem a ação nem o
 *    evento ficam (F70-S17).
 *  - evento de OUTRO workspace declarado por um handler com defeito: a RLS da outbox
 *    recusa, e a ação inteira é desfeita (fail-closed).
 *  - a auditoria em `tool_logs` é best-effort de verdade: uma falha no INSERT do log
 *    (FK violada) não desfaz a ação nem o evento, nem vira 500.
 *
 * A outbox é lida pelo `workspace_id` (sem RabbitMQ). Skip automático se o Postgres
 * dev não estiver acessível.
 *
 * F70-S15: o endpoint só executa tool habilitada para o agente, numa execução em
 * curso dele — o setup cria o agente, habilita as tools e abre uma execução por chamada.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';

const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../../routes/deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});

const { closeDb, getDb, schema } = await import('@hm/db');
const { domainEvents } = await import('@hm/shared/mq');
const { outboxEventsOf } = await import('../../routes/deals/__tests__/outbox');
const { createInternalToolsRouter } = await import('./router');
const { ToolHandlerRegistry } = await import('./registry');
const { buildWorkflowRegistry } = await import('./workflow-handlers');

const TOKEN = 'test-runtime-token-f70s09';
const WS = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();
const AGENT_ID = randomUUID();

let dbAvailable = true;

/** Eventos da outbox do workspace do teste para uma conversa, na ordem. */
async function outboxOf(conversationId: string) {
  return (await outboxEventsOf(WS)).filter((r) => r.data['conversationId'] === conversationId);
}

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

/**
 * Handler com defeito: resolve a conversa e declara o evento com o workspace ERRADO.
 * A barreira é liberada (a tool não existe em `tools`); a auditoria, se chegasse a
 * rodar, falharia na FK. O que se prova é a ação desfeita junto com o evento.
 */
const appWithForeignEvent = express();
appWithForeignEvent.use(express.json());
appWithForeignEvent.use(
  createInternalToolsRouter({
    registry: new ToolHandlerRegistry().register('leaky_resolve', async (envelope, tx) => {
      const conversationId = envelope.conversationId ?? '';
      await tx
        .update(schema.conversations)
        .set({ status: 'resolved' })
        .where(eq(schema.conversations.id, conversationId));
      return {
        ok: true,
        content: 'ok',
        events: [
          domainEvents.conversationResolved(randomUUID(), {
            conversationId,
            resolvedBy: 'agent',
            memberId: null,
            agentId: envelope.agentId,
          }),
        ],
      };
    }),
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

async function conversationRow(id: string) {
  const [row] = await getDb()
    .select({ aiMode: schema.conversations.aiMode, status: schema.conversations.status })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id));
  return row;
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
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
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

describe('F70-S09/S17 — eventos de domínio das tools da IA na outbox', () => {
  maybe('transfer_to_human grava conversation.handoff mínimo na transação da ação', async () => {
    const conv = await freshConversation();
    const executionId = await freshExecution(conv);

    const res = await callTool('transfer_to_human', conv, executionId, {
      reason: 'Cliente Maria (CPF 123.456.789-00) quer falar com humano',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const rows = await outboxOf(conv);
    expect(rows).toHaveLength(1);
    const evt = rows[0];
    expect(evt).toMatchObject({
      kind: 'event',
      eventId: `${conv}:handoff:${executionId}`,
      exchange: 'hm.events',
      routingKey: 'domain.conversation.handoff',
      event: 'conversation.handoff',
      workspaceId: WS,
    });
    expect(evt?.data).toEqual({ conversationId: conv, agentId: AGENT_ID, departmentId: null });
    // O texto do modelo não sai em lugar nenhum do evento.
    expect(JSON.stringify(evt)).not.toContain('CPF');

    // Commitados juntos: a conversa está com humano.
    expect(await conversationRow(conv)).toEqual({ aiMode: 'off', status: 'pending' });

    // A trilha de auditoria foi gravada (transação própria, depois da ação).
    const logs = await getDb()
      .select({ action: schema.toolLogs.action, error: schema.toolLogs.error })
      .from(schema.toolLogs)
      .where(
        and(eq(schema.toolLogs.workspaceId, WS), eq(schema.toolLogs.executionId, executionId)),
      );
    expect(logs).toEqual([{ action: 'transfer_to_human', error: null }]);
  });

  maybe('mark_resolved grava conversation.resolved com autor agente', async () => {
    const conv = await freshConversation();
    const executionId = await freshExecution(conv);
    const res = await callTool('mark_resolved', conv, executionId, { resolution: 'ok' });
    expect(res.status).toBe(200);

    const rows = await outboxOf(conv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'conversation.resolved',
      routingKey: 'domain.conversation.resolved',
    });
    // F70-S20: ocorrência = execução, como o handoff.
    expect(rows[0]?.eventId).toBe(`${conv}:resolved:${executionId}`);
    expect(rows[0]?.data).toEqual({
      conversationId: conv,
      resolvedBy: 'agent',
      memberId: null,
      agentId: AGENT_ID,
    });
  });

  maybe('mark_resolved repetido na mesma execução → um evento só (F70-S20)', async () => {
    const conv = await freshConversation();
    const executionId = await freshExecution(conv);
    const first = await callTool('mark_resolved', conv, executionId, { resolution: 'ok' });
    const again = await callTool('mark_resolved', conv, executionId, { resolution: 'de novo' });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);

    const rows = await outboxOf(conv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toBe(`${conv}:resolved:${executionId}`);

    // Outra execução que resolve a mesma conversa é outra ocorrência.
    const next = await freshExecution(conv);
    expect((await callTool('mark_resolved', conv, next, { resolution: 'ok' })).status).toBe(200);
    expect((await outboxOf(conv)).map((r) => r.eventId)).toEqual([
      `${conv}:resolved:${executionId}`,
      `${conv}:resolved:${next}`,
    ]);
  });

  maybe('tool que falha não grava evento', async () => {
    const conv = await freshConversation();
    // Args inválidos: o handler recusa (422) depois de passar pela barreira.
    const res = await callTool('transfer_to_human', conv, await freshExecution(conv), {
      reason: '',
    });
    expect(res.status).toBe(422);
    expect(await outboxOf(conv)).toHaveLength(0);
  });

  maybe('rollback depois da ação e do enqueue: nem a ação nem o evento ficam', async () => {
    const conv = await freshConversation();
    const executionId = await freshExecution(conv);
    rollback.armed = true;
    const res = await callTool('mark_resolved', conv, executionId, { resolution: 'ok' });
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect(await conversationRow(conv)).toEqual({ aiMode: 'on', status: 'open' });
    expect(await outboxOf(conv)).toHaveLength(0);
  });

  maybe('evento de outro workspace: a RLS da outbox recusa e a ação é desfeita', async () => {
    const conv = await freshConversation();
    const res = await callTool(
      'leaky_resolve',
      conv,
      await freshExecution(conv),
      {},
      appWithForeignEvent,
    );
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);

    expect(await conversationRow(conv)).toEqual({ aiMode: 'on', status: 'open' });
    expect(await outboxOf(conv)).toHaveLength(0);
  });

  maybe('falha ao gravar tool_logs não desfaz a ação nem o evento, nem vira 500', async () => {
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
    expect(await outboxOf(conv)).toHaveLength(1);

    expect((await conversationRow(conv))?.status).toBe('resolved');

    const logs = await getDb()
      .select({ id: schema.toolLogs.id })
      .from(schema.toolLogs)
      .where(eq(schema.toolLogs.executionId, executionId));
    expect(logs).toHaveLength(0);
  });
});
