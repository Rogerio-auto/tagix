/**
 * F70-S09 — eventos de domínio das tools da IA, pelo endpoint interno real
 * (`POST /internal/tools/:toolKey`) contra o Postgres dev (RLS real).
 *
 * Prova:
 *  - `transfer_to_human` publica `conversation.handoff` DEPOIS do commit, com o
 *    payload mínimo (sem o `reason` escrito pelo modelo) e ocorrência = execução.
 *  - `mark_resolved` publica `conversation.resolved` (autor = agente).
 *  - tool que falha (conversa inexistente) não publica nada.
 *
 * O transporte do emissor é trocado por um coletor (sem RabbitMQ). Skip automático
 * se o Postgres dev não estiver acessível.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
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

function callTool(
  toolKey: string,
  conversationId: string,
  executionId: string,
  args: Record<string, unknown>,
) {
  return request(app)
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
    await db.insert(schema.workspaces).values({ id: WS, name: 'F70S09 tools', slug: `f70s09-${WS.slice(0, 8)}` });
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
    const executionId = randomUUID();

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
  });

  maybe('mark_resolved publica conversation.resolved com autor agente', async () => {
    const conv = await freshConversation();
    const res = await callTool('mark_resolved', conv, randomUUID(), { resolution: 'ok' });
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
    const res = await callTool('transfer_to_human', randomUUID(), randomUUID(), { reason: 'x' });
    expect(res.status).toBe(422);
    expect(published).toHaveLength(0);
  });
});
