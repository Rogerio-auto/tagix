/**
 * F70-S26 — turno da IA idempotente por envelope (Postgres dev, RLS real do `withWorkspace`,
 * `DbAgentRunStore` real, `resolvePolicy` real, runtime FALSO que conta as chamadas).
 *
 * O envelope entra por `handleAgentEnvelope`, o mesmo caminho do consumer:
 *  - o mesmo envelope entregue duas vezes, em paralelo ou em sequência → UMA chamada ao
 *    runtime, UMA mensagem do agente e UM job de envio;
 *  - turno que falhou antes do runtime → a retentativa roda (mesma execução, tentativa 2);
 *  - `claimed` com lease vigente → a entrega repetida pede retentativa; lease vencido → roda;
 *  - falha depois do runtime responder → a retentativa grava a resposta guardada, sem runtime;
 *  - queda com o runtime em curso (`running`) → a retentativa não chama o runtime de novo;
 *  - envelope antigo em voo (sem `triggerId`) também deduplica, e gatilhos diferentes na
 *    mesma conversa continuam sendo turnos diferentes.
 *
 * Pula sem `DATABASE_URL` (rode com `node --env-file=.env`).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import {
  AGENT_RUN_REQUESTED_TYPE,
  agentRunJobOutbox,
  agentRunTriggerId,
  makeEnvelope,
  type Envelope,
} from '@hm/shared/mq';
import type { AgentStreamEvent } from '@hm/agents-client';
import { outboxRowsOf } from '../outbox/testing';
import {
  AgentTurnInFlightError,
  DbAgentRunStore,
  TURN_CLAIM_LEASE_MS,
  type AgentRunDeps,
  type AgentRunStore,
} from './run';
import { handleAgentEnvelope, type AgentWorkerOptions } from './worker';

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('turno da IA idempotente por envelope (DB, F70-S26)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const AGENT = randomUUID();
  const sfx = WS.slice(0, 8);
  const REPLY = 'Olá! Posso ajudar com o seu pedido.';

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  /** Runtime falso: conta chamadas; `gate` segura o stream até o teste liberar. */
  const runtime = {
    calls: 0,
    gate: null as Promise<void> | null,
  };
  async function* fakeRun(): AsyncGenerator<AgentStreamEvent, void, unknown> {
    runtime.calls += 1;
    if (runtime.gate !== null) await runtime.gate;
    yield { type: 'token', content: REPLY };
    yield {
      type: 'final',
      reply: REPLY,
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8, total_cost_usd: 0 },
      openrouter_generation_id: null,
    };
  }

  function options(store: AgentRunStore = new DbAgentRunStore()): AgentWorkerOptions {
    const deps: AgentRunDeps = {
      store,
      socket: { emitStarted: vi.fn(async () => {}), emitCompleted: vi.fn(async () => {}) },
      client: {
        run: fakeRun,
        health: vi.fn(),
        cancel: vi.fn(),
      } as unknown as AgentRunDeps['client'],
      logger: logger as unknown as AgentRunDeps['logger'],
    };
    return { deps, logger: deps.logger, aggregation: false };
  }

  /** Store real com UMA porta trocada (falha injetada ou pausa). */
  function storeWith(override: Partial<AgentRunStore>): AgentRunStore {
    const real = new DbAgentRunStore();
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in override) {
          return override[prop as keyof AgentRunStore];
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  async function newConversation(): Promise<{ conversationId: string; externalId: string }> {
    const conversationId = randomUUID();
    const externalId = `wamid.f70s26.${randomUUID()}`;
    await getDb()
      .insert(schema.conversations)
      .values({
        id: conversationId,
        workspaceId: WS,
        channelId: CHANNEL,
        contactId: CONTACT,
        remoteId: `r-${conversationId.slice(0, 12)}`,
        aiMode: 'on',
        origin: 'origem:anuncio',
        agentId: AGENT,
      });
    await getDb().insert(schema.messages).values({
      workspaceId: WS,
      conversationId,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: 'Quero saber do meu pedido',
      externalId,
    });
    return { conversationId, externalId };
  }

  function inboundEnvelope(conversationId: string, externalId: string): Envelope {
    return agentRunJobOutbox(WS, {
      conversationId,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
      triggerExternalId: externalId,
    }).envelope;
  }

  async function agentMessages(conversationId: string) {
    return getDb()
      .select({ id: schema.messages.id, content: schema.messages.content })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.senderType, 'agent'),
        ),
      );
  }

  async function outboundJobs(conversationId: string) {
    return (await outboxRowsOf(WS)).filter(
      (r) =>
        r.routingKey === 'hm.q.outbound' &&
        (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
    );
  }

  async function turns(conversationId: string) {
    const ae = schema.agentExecutions;
    return getDb()
      .select({
        id: ae.id,
        status: ae.status,
        triggerId: ae.triggerId,
        turnState: ae.turnState,
        turnAttempts: ae.turnAttempts,
        turnReply: ae.turnReply,
      })
      .from(ae)
      .where(eq(ae.conversationId, conversationId));
  }

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'F70S26', slug: `f70s26-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S26',
      phoneNumberId: `PN_F70S26_${sfx}`,
      wabaId: `WABA_F70S26_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55119' + sfx.replace(/\D/g, '3').padEnd(8, '3').slice(0, 8),
    });
    await db.insert(schema.agents).values({
      id: AGENT,
      workspaceId: WS,
      name: 'F70S26',
      systemPrompt: 'F70-S26',
      status: 'active',
    });
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  beforeEach(() => {
    runtime.calls = 0;
    runtime.gate = null;
    vi.clearAllMocks();
  });

  it('o mesmo envelope entregue duas vezes EM PARALELO → um runtime, uma mensagem, um job', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);

    const settled = await Promise.allSettled([
      handleAgentEnvelope(envelope, options()),
      handleAgentEnvelope(envelope, options()),
    ]);
    // A perdedora ou vê o turno no runtime (no-op) ou o encontra antes dele (retentar).
    for (const s of settled) {
      if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(AgentTurnInFlightError);
    }
    // A retentativa da fila, depois: no-op.
    await handleAgentEnvelope(envelope, options());

    expect(runtime.calls).toBe(1);
    const messages = await agentMessages(conversationId);
    expect(messages).toEqual([{ id: expect.any(String), content: REPLY }]);
    const jobs = await outboundJobs(conversationId);
    expect(jobs).toHaveLength(1);
    expect((jobs[0]?.envelope.payload as Record<string, unknown>)['messageId']).toBe(
      messages[0]?.id,
    );
    expect(await turns(conversationId)).toEqual([
      {
        id: expect.any(String),
        status: 'completed',
        triggerId: agentRunTriggerId.inbound(conversationId, externalId),
        turnState: 'completed',
        turnAttempts: 1,
        turnReply: null,
      },
    ]);
  });

  it('entrega repetida com a primeira ainda antes do runtime → pede retentativa; depois, no-op', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);

    // A primeira entrega para depois de reivindicar (em `claimed`) até a segunda terminar.
    const hold = deferred();
    const reached = deferred();
    const real = new DbAgentRunStore();
    const paused = storeWith({
      loadTools: async (ws, agentId) => {
        reached.resolve();
        await hold.promise;
        return real.loadTools(ws, agentId);
      },
    });

    const first = handleAgentEnvelope(envelope, options(paused));
    await reached.promise;
    await expect(handleAgentEnvelope(envelope, options())).rejects.toBeInstanceOf(
      AgentTurnInFlightError,
    );
    hold.resolve();
    await first;
    // A retentativa da segunda chega depois: o turno já concluiu.
    await handleAgentEnvelope(envelope, options());

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(1);
    expect(await outboundJobs(conversationId)).toHaveLength(1);
  });

  it('entrega repetida com a primeira no runtime → no-op imediato (sem segundo runtime)', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);
    const release = deferred();
    runtime.gate = release.promise;

    const first = handleAgentEnvelope(envelope, options());
    await vi.waitFor(() => expect(runtime.calls).toBe(1));
    await handleAgentEnvelope(envelope, options()); // resolve: gatilho já no runtime
    release.resolve();
    await first;

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('gatilho repetido'),
      expect.objectContaining({ turnState: 'running' }),
    );
  });

  it('turno que falhou ANTES do runtime → a retentativa roda (mesma execução, tentativa 2)', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);
    const broken = storeWith({
      loadTools: () => Promise.reject(new Error('F70-S26: banco piscou antes do runtime')),
    });

    await expect(handleAgentEnvelope(envelope, options(broken))).rejects.toThrow(
      'banco piscou antes do runtime',
    );
    expect(runtime.calls).toBe(0);
    const [failed] = await turns(conversationId);
    expect(failed).toMatchObject({ status: 'failed', turnState: 'failed_before_runtime' });

    // A retentativa da fila (ladder) entrega o mesmo envelope.
    await handleAgentEnvelope(envelope, options());

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(1);
    expect(await turns(conversationId)).toEqual([
      expect.objectContaining({
        id: failed?.id,
        status: 'completed',
        turnState: 'completed',
        turnAttempts: 2,
      }),
    ]);
  });

  it('`claimed` abandonado (processo morreu antes do runtime): lease vigente segura, vencido libera', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);
    const triggerId = agentRunTriggerId.inbound(conversationId, externalId);

    // A entrega que morreu: reivindicou e nunca passou daí.
    const claim = await new DbAgentRunStore().claimTurn({
      workspaceId: WS,
      agentId: AGENT,
      conversationId,
      threadId: conversationId,
      triggerId,
      leaseMs: TURN_CLAIM_LEASE_MS,
    });
    expect(claim.kind).toBe('acquired');

    await expect(handleAgentEnvelope(envelope, options())).rejects.toBeInstanceOf(
      AgentTurnInFlightError,
    );
    expect(runtime.calls).toBe(0);

    await getDb()
      .update(schema.agentExecutions)
      .set({ turnClaimedAt: sql`now() - interval '10 minutes'` })
      .where(eq(schema.agentExecutions.triggerId, triggerId));
    await handleAgentEnvelope(envelope, options());

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(1);
    expect(await turns(conversationId)).toEqual([
      expect.objectContaining({ turnState: 'completed', turnAttempts: 2 }),
    ]);
  });

  it('falha DEPOIS do runtime responder → a retentativa grava a resposta guardada, sem runtime', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);
    const broken = storeWith({
      deliverTurnReply: () => Promise.reject(new Error('F70-S26: banco piscou ao gravar')),
    });

    await expect(handleAgentEnvelope(envelope, options(broken))).rejects.toThrow(
      'banco piscou ao gravar',
    );
    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(0);
    expect(await turns(conversationId)).toEqual([
      expect.objectContaining({ turnState: 'responded', turnReply: REPLY }),
    ]);

    // Duas retentativas concorrentes da resposta guardada: uma grava, a outra não.
    await Promise.all([
      handleAgentEnvelope(envelope, options()),
      handleAgentEnvelope(envelope, options()),
    ]);

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toEqual([
      { id: expect.any(String), content: REPLY },
    ]);
    expect(await outboundJobs(conversationId)).toHaveLength(1);
    expect(await turns(conversationId)).toEqual([
      expect.objectContaining({ turnState: 'completed', turnReply: null }),
    ]);
  });

  it('queda com o runtime em curso (antes de guardar a resposta) → retentativa NÃO repete o runtime', async () => {
    const { conversationId, externalId } = await newConversation();
    const envelope = inboundEnvelope(conversationId, externalId);
    const broken = storeWith({
      saveTurnReply: () => Promise.reject(new Error('F70-S26: queda no meio do turno')),
    });

    await expect(handleAgentEnvelope(envelope, options(broken))).rejects.toThrow(
      'queda no meio do turno',
    );
    await handleAgentEnvelope(envelope, options());

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(0);
    expect(await turns(conversationId)).toEqual([
      expect.objectContaining({ turnState: 'running' }),
    ]);
  });

  it('envelope antigo em voo, sem triggerId: republicado duas vezes → um turno', async () => {
    const { conversationId } = await newConversation();
    // Gatilho proativo gravado antes da F70-S26 (sem triggerId nem triggerExternalId).
    const legacy = makeEnvelope(AGENT_RUN_REQUESTED_TYPE, WS, {
      conversationId,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
    });

    await handleAgentEnvelope(legacy, options());
    await handleAgentEnvelope(legacy, options());

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(1);
    expect(await turns(conversationId)).toEqual([
      expect.objectContaining({ triggerId: agentRunTriggerId.event(legacy.id) }),
    ]);
  });

  it('inbound antigo (só triggerExternalId) e o novo do mesmo fato → um turno', async () => {
    const { conversationId, externalId } = await newConversation();
    const legacy = makeEnvelope(AGENT_RUN_REQUESTED_TYPE, WS, {
      conversationId,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
      triggerExternalId: externalId,
    });

    await handleAgentEnvelope(legacy, options());
    await handleAgentEnvelope(inboundEnvelope(conversationId, externalId), options());

    expect(runtime.calls).toBe(1);
    expect(await agentMessages(conversationId)).toHaveLength(1);
  });

  it('gatilhos diferentes na mesma conversa continuam sendo turnos diferentes', async () => {
    const { conversationId, externalId } = await newConversation();
    const followup = agentRunJobOutbox(WS, {
      conversationId,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
      triggerId: agentRunTriggerId.followup(conversationId, 1_790_000_000),
    }).envelope;

    await handleAgentEnvelope(inboundEnvelope(conversationId, externalId), options());
    await handleAgentEnvelope(followup, options());

    expect(runtime.calls).toBe(2);
    expect(await agentMessages(conversationId)).toHaveLength(2);
    expect((await turns(conversationId)).map((t) => t.turnState)).toEqual([
      'completed',
      'completed',
    ]);
  });
});
