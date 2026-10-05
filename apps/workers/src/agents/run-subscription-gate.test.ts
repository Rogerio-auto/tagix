/**
 * F71-S06 — o turno do agente IA não roda em empresa sem assinatura ativa.
 *
 * Postgres dev com o `DbAgentRunStore` real e o portão real (`subscriptionGate`, lê
 * `workspaces` a cada turno); o runtime é um fake que conta chamadas. A mesma conversa
 * (IA `on`, origem elegível) responde com a empresa ativa e não responde com `expired`,
 * `canceled` ou trial vencido — nenhuma execução, nenhuma mensagem do agente, nenhum job.
 *
 * Skip automático sem `DATABASE_URL` (rode com `node --env-file=.env`).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { AgentStreamEvent } from '@hm/agents-client';
import { DbAgentRunStore, runAgent, type AgentRunDeps } from './run';
import { subscriptionGate } from '../lib/subscription-gate';

const url = process.env['DATABASE_URL'];
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!url)('worker de agentes — portão de assinatura (DB, F71-S06)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const AGENT = randomUUID();
  const sfx = WS.slice(0, 8);

  let runtimeCalls = 0;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  async function* fakeRuntime(): AsyncGenerator<AgentStreamEvent, void, unknown> {
    runtimeCalls += 1;
    yield {
      type: 'final',
      reply: 'Olá!',
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
    logger: logger as unknown as AgentRunDeps['logger'],
    subscription: subscriptionGate,
  };

  async function setStatus(subscriptionStatus: string, trialEndsAt: Date | null = null) {
    await getDb()
      .update(schema.workspaces)
      .set({ subscriptionStatus, trialEndsAt })
      .where(eq(schema.workspaces.id, WS));
  }

  async function newConversation(): Promise<string> {
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
        origin: 'origem:anuncio',
        agentId: AGENT,
      });
    await getDb().insert(schema.messages).values({
      workspaceId: WS,
      conversationId: id,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: 'oi',
    });
    return id;
  }

  async function sideEffects(conversationId: string) {
    const executions = await getDb()
      .select({ id: schema.agentExecutions.id })
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.conversationId, conversationId));
    const agentMessages = await getDb()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.senderType, 'agent'),
        ),
      );
    return { executions: executions.length, agentMessages: agentMessages.length };
  }

  const run = (conversationId: string) =>
    runAgent(
      WS,
      { conversationId, contactId: CONTACT, channelId: CHANNEL, provider: 'meta_whatsapp' },
      deps,
    );

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'F71S06 IA', slug: `f71s06-ia-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F71S06',
      phoneNumberId: `PN_F71S06_IA_${sfx}`,
      wabaId: `WABA_F71S06_IA_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55117' + sfx.replace(/\D/g, '3').padEnd(8, '3').slice(0, 8),
    });
    await db.insert(schema.agents).values({
      id: AGENT,
      workspaceId: WS,
      name: 'F71S06',
      systemPrompt: 'F71-S06',
      status: 'active',
    });
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  it('empresa expired → skip; nada roda, nada é gravado nem enviado', async () => {
    await setStatus('expired');
    const conv = await newConversation();
    const before = runtimeCalls;

    expect(await run(conv)).toEqual({ status: 'skipped', reason: 'subscription_inactive' });
    expect(runtimeCalls).toBe(before);
    expect(await sideEffects(conv)).toEqual({ executions: 0, agentMessages: 0 });
  });

  it('canceled e trial vencido também não respondem', async () => {
    for (const [status, ends] of [
      ['canceled', null],
      ['trial', new Date(Date.now() - DAY)],
    ] as const) {
      await setStatus(status, ends);
      const conv = await newConversation();
      expect(await run(conv)).toEqual({ status: 'skipped', reason: 'subscription_inactive' });
      expect(await sideEffects(conv)).toEqual({ executions: 0, agentMessages: 0 });
    }
  });

  it('a mesma conversa com a assinatura ativa (ou past_due) → responde', async () => {
    for (const status of ['active', 'past_due']) {
      await setStatus(status);
      const conv = await newConversation();
      const before = runtimeCalls;
      expect((await run(conv)).status).toBe('replied');
      expect(runtimeCalls).toBe(before + 1);
      expect(await sideEffects(conv)).toEqual({ executions: 1, agentMessages: 1 });
    }
  });
});
