/**
 * F70-S19 (achado M2) — o worker de agentes só responde com origem elegível OU com a
 * marca "IA ligada por um humano" posterior ao último `on` automático.
 *
 * 1) Puro: `authorizeAiReply` (regra e fail-closed).
 * 2) Postgres dev: `runAgent` com o `DbAgentRunStore` real, o trigger real da migração
 *    0088 e `resolvePolicy` real; o runtime é um fake que conta as chamadas.
 *    A marca humana é gravada com o MESMO `set` das rotas `POST /ai-mode` e
 *    `POST /agent` da API (`aiEnabledAt: clock_timestamp()`, `aiEnabledBy: <membro>`).
 *
 * Skip automático do bloco de banco sem `DATABASE_URL` (rode com `node --env-file=.env`).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { AgentStreamEvent } from '@hm/agents-client';
import type { ConversationOriginValue } from '@hm/shared';
import { authorizeAiReply, DbAgentRunStore, runAgent, type AgentRunDeps } from './run';
import { subscriptionGate } from '../lib/subscription-gate';

const url = process.env['DATABASE_URL'];

/** SQLSTATE do erro do driver (o Drizzle embrulha; o código vive em `cause`). */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && typeof current === 'object' && current !== null; i += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

// ─── 1) Regra pura ────────────────────────────────────────────────────────────

describe('authorizeAiReply (F70-S19)', () => {
  const t0 = new Date('2026-09-25T10:00:00.000Z');
  const t1 = new Date('2026-09-25T10:00:01.000Z');

  it('origem elegível responde sem marca humana', () => {
    for (const origin of ['origem:anuncio', 'origem:site', 'origem:instagram']) {
      expect(authorizeAiReply({ origin, aiEnabledAt: null, aiAutoEnabledAt: null })).toEqual({
        allowed: true,
        basis: 'origin',
      });
    }
  });

  it('legado (origem NULL), sem-origem, prospecção e valor desconhecido sem marca → não responde', () => {
    for (const origin of [null, 'sem-origem', 'origem:prospeccao', 'origem:qualquer']) {
      expect(authorizeAiReply({ origin, aiEnabledAt: null, aiAutoEnabledAt: null })).toEqual({
        allowed: false,
      });
    }
  });

  it('marca humana sem `on` automático → responde', () => {
    expect(authorizeAiReply({ origin: null, aiEnabledAt: t0, aiAutoEnabledAt: null })).toEqual({
      allowed: true,
      basis: 'human',
    });
  });

  it('marca humana posterior ao `on` automático → responde; anterior ou empatada → não', () => {
    expect(authorizeAiReply({ origin: null, aiEnabledAt: t1, aiAutoEnabledAt: t0 }).allowed).toBe(
      true,
    );
    expect(authorizeAiReply({ origin: null, aiEnabledAt: t0, aiAutoEnabledAt: t1 }).allowed).toBe(
      false,
    );
    expect(authorizeAiReply({ origin: null, aiEnabledAt: t0, aiAutoEnabledAt: t0 }).allowed).toBe(
      false,
    );
  });

  it('data inválida conta como ausente (fail-closed)', () => {
    const invalid = new Date(Number.NaN);
    expect(
      authorizeAiReply({ origin: null, aiEnabledAt: invalid, aiAutoEnabledAt: null }).allowed,
    ).toBe(false);
  });
});

describe('authorizeAiReply com a trava do workspace (F70-S30)', () => {
  const none = { aiEnabledAt: null, aiAutoEnabledAt: null };

  it('trava desligada: qualquer origem responde sem marca humana', () => {
    for (const origin of [null, 'sem-origem', 'origem:prospeccao', 'origem:qualquer']) {
      expect(authorizeAiReply({ ...none, origin, requiresProvenOrigin: false })).toEqual({
        allowed: true,
        basis: 'origin_gate_off',
      });
    }
  });

  it('trava ligada, ausente ou null: vale a regra da origem (fail-closed)', () => {
    for (const requiresProvenOrigin of [true, null, undefined]) {
      expect(
        authorizeAiReply({ ...none, origin: 'sem-origem', requiresProvenOrigin }).allowed,
      ).toBe(false);
      expect(
        authorizeAiReply({ ...none, origin: 'origem:anuncio', requiresProvenOrigin }),
      ).toEqual({ allowed: true, basis: 'origin' });
    }
  });
});

// ─── 2) Postgres dev ─────────────────────────────────────────────────────────

describe.skipIf(!url)('worker de agentes — trava de origem e marca humana (DB, F70-S19)', () => {
  const WS = randomUUID();
  const OTHER_WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const AGENT = randomUUID();
  const MEMBER = randomUUID();
  const FOREIGN_MEMBER = randomUUID();
  const sfx = WS.slice(0, 8);

  let runtimeCalls = 0;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  async function* fakeRuntime(): AsyncGenerator<AgentStreamEvent, void, unknown> {
    runtimeCalls += 1;
    yield {
      type: 'final',
      reply: 'Olá! Como posso ajudar?',
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
    // F71-S06: portão real — as empresas destes testes estão em trial sem data (ativas).
    subscription: subscriptionGate,
  };

  async function newConversation(
    origin: ConversationOriginValue | null,
    aiMode: 'on' | 'off',
  ): Promise<string> {
    const id = randomUUID();
    await getDb()
      .insert(schema.conversations)
      .values({
        id,
        workspaceId: WS,
        channelId: CHANNEL,
        contactId: CONTACT,
        remoteId: `r-${id.slice(0, 12)}`,
        aiMode,
        origin,
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

  /** O mesmo `set` das rotas humanas (`state.ts` ao ligar, `agent.ts`). */
  async function humanTurnsOn(conversationId: string, memberId = MEMBER): Promise<void> {
    await getDb()
      .update(schema.conversations)
      .set({
        aiMode: 'on',
        aiPausedReason: null,
        aiPausedAt: null,
        aiPausedBy: null,
        aiResumeAt: null,
        aiEnabledAt: sql`clock_timestamp()`,
        aiEnabledBy: memberId,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversations.id, conversationId));
  }

  /** Um caminho automático qualquer (sem marca humana), como os UPDATEs da F70-S07/S08. */
  async function automationSets(
    conversationId: string,
    aiMode: 'on' | 'off' | 'paused',
  ): Promise<void> {
    await getDb()
      .update(schema.conversations)
      .set({ aiMode, updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));
  }

  async function marks(conversationId: string) {
    const [row] = await getDb()
      .select({
        aiEnabledAt: schema.conversations.aiEnabledAt,
        aiEnabledBy: schema.conversations.aiEnabledBy,
        aiAutoEnabledAt: schema.conversations.aiAutoEnabledAt,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (!row) throw new Error('conversa sumiu');
    return row;
  }

  async function agentSideEffects(conversationId: string) {
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

  function run(conversationId: string) {
    return runAgent(
      WS,
      { conversationId, contactId: CONTACT, channelId: CHANNEL, provider: 'meta_whatsapp' },
      deps,
    );
  }

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values([
      { id: WS, name: 'F70S19 gate', slug: `f70s19-gt-${sfx}` },
      { id: OTHER_WS, name: 'F70S19 outro', slug: `f70s19-ot-${sfx}` },
    ]);
    await db.insert(schema.members).values([
      {
        id: MEMBER,
        workspaceId: WS,
        authUserId: randomUUID(),
        email: `f70s19-${sfx}@example.test`,
        role: 'AGENT',
        status: 'active',
      },
      {
        id: FOREIGN_MEMBER,
        workspaceId: OTHER_WS,
        authUserId: randomUUID(),
        email: `f70s19-ot-${sfx}@example.test`,
        role: 'OWNER',
        status: 'active',
      },
    ]);
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S19',
      phoneNumberId: `PN_F70S19_${sfx}`,
      wabaId: `WABA_F70S19_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55118' + sfx.replace(/\D/g, '7').padEnd(8, '7').slice(0, 8),
    });
    await db.insert(schema.agents).values({
      id: AGENT,
      workspaceId: WS,
      name: 'F70S19',
      systemPrompt: 'F70-S19',
      status: 'active',
    });
  });

  afterAll(async () => {
    await getDb()
      .delete(schema.workspaces)
      .where(inArray(schema.workspaces.id, [WS, OTHER_WS]));
    await closeDb();
  });

  it('conversa `on` legada, sem origem e sem marca humana → o worker não responde', async () => {
    const conv = await newConversation(null, 'on');
    const before = runtimeCalls;
    logger.warn.mockClear();

    const outcome = await run(conv);

    expect(outcome).toEqual({ status: 'skipped', reason: 'origin_not_eligible' });
    expect(runtimeCalls).toBe(before);
    expect(await agentSideEffects(conv)).toEqual({ executions: 0, agentMessages: 0 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('não responde'),
      expect.objectContaining({ conversationId: conv, origin: null, hasHumanMark: false }),
    );
  });

  it('a mesma conversa ligada por um humano → responde', async () => {
    const conv = await newConversation(null, 'on');
    await humanTurnsOn(conv);
    const m = await marks(conv);
    expect(m.aiEnabledAt).toBeInstanceOf(Date);
    expect(m.aiEnabledBy).toBe(MEMBER);
    // on → on não é transição: o trigger não marca `on` automático.
    expect(m.aiAutoEnabledAt).toBeNull();

    const before = runtimeCalls;
    const outcome = await run(conv);

    expect(outcome.status).toBe('replied');
    expect(runtimeCalls).toBe(before + 1);
    expect(await agentSideEffects(conv)).toEqual({ executions: 1, agentMessages: 1 });
  });

  it('`sem-origem` desligada, ligada por um humano → responde', async () => {
    const conv = await newConversation('sem-origem', 'off');
    await humanTurnsOn(conv);
    expect((await run(conv)).status).toBe('replied');
  });

  it('um `on` automático depois da marca humana a invalida; religar à mão volta a valer', async () => {
    const conv = await newConversation(null, 'off');
    await humanTurnsOn(conv);
    await automationSets(conv, 'paused');
    await automationSets(conv, 'on'); // caminho sem trava (ou SQL manual): sem marca humana

    const m = await marks(conv);
    expect(m.aiAutoEnabledAt).toBeInstanceOf(Date);
    expect(m.aiAutoEnabledAt!.getTime()).toBeGreaterThan(m.aiEnabledAt!.getTime());
    expect(await run(conv)).toEqual({ status: 'skipped', reason: 'origin_not_eligible' });

    await humanTurnsOn(conv);
    expect((await run(conv)).status).toBe('replied');
  });

  it('origem elegível ligada pela automação → responde sem marca humana', async () => {
    const conv = await newConversation('origem:anuncio', 'off');
    await automationSets(conv, 'on');
    const m = await marks(conv);
    expect(m.aiEnabledAt).toBeNull();
    expect(m.aiAutoEnabledAt).toBeInstanceOf(Date);
    expect((await run(conv)).status).toBe('replied');
  });

  it('a marca não aceita membro de outro workspace (FK composta)', async () => {
    const conv = await newConversation(null, 'off');
    let error: unknown;
    try {
      await humanTurnsOn(conv, FOREIGN_MEMBER);
    } catch (err) {
      error = err;
    }
    expect(sqlState(error)).toBe('23503');
    expect((await marks(conv)).aiEnabledAt).toBeNull();
  });

  describe('trava de origem desligada no workspace (F70-S30)', () => {
    async function setLock(value: boolean): Promise<void> {
      await getDb()
        .update(schema.workspaces)
        .set({ aiRequiresProvenOrigin: value })
        .where(eq(schema.workspaces.id, WS));
    }

    it('conversa `on` sem origem e sem marca humana → responde; religar a trava → barra', async () => {
      const legacy = await newConversation(null, 'on');
      const noOrigin = await newConversation('sem-origem', 'off');
      await setLock(false);
      try {
        await automationSets(noOrigin, 'on'); // `on` automático: carimba ai_auto_enabled_at
        expect((await marks(noOrigin)).aiAutoEnabledAt).toBeInstanceOf(Date);

        const before = runtimeCalls;
        expect((await run(legacy)).status).toBe('replied');
        expect((await run(noOrigin)).status).toBe('replied');
        expect(runtimeCalls).toBe(before + 2);
      } finally {
        await setLock(true);
      }

      // A trava vale no turno seguinte: sem origem e sem marca humana, o worker para.
      const other = await newConversation('sem-origem', 'on');
      logger.warn.mockClear();
      expect(await run(other)).toEqual({ status: 'skipped', reason: 'origin_not_eligible' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('não responde'),
        expect.objectContaining({ conversationId: other, requiresProvenOrigin: true }),
      );
    });
  });

  it('membro removido: a autoria vira NULL e a marca continua valendo', async () => {
    const leaving = randomUUID();
    await getDb()
      .insert(schema.members)
      .values({
        id: leaving,
        workspaceId: WS,
        authUserId: randomUUID(),
        email: `f70s19-lv-${sfx}@example.test`,
        role: 'AGENT',
        status: 'active',
      });
    const conv = await newConversation(null, 'off');
    await humanTurnsOn(conv, leaving);
    await getDb().delete(schema.members).where(eq(schema.members.id, leaving));

    const m = await marks(conv);
    expect(m.aiEnabledBy).toBeNull();
    expect(m.aiEnabledAt).toBeInstanceOf(Date);
    expect((await run(conv)).status).toBe('replied');
  });
});
