/**
 * F70-S25 — `transfer_to_agent` grava o gatilho do agente de IA (`flow.run.requested` →
 * `hm.q.flows`) na outbox, na transação da transferência (Postgres dev, RLS real, re-engaje
 * DEFAULT — sem injeção):
 *  - commit: agente trocado, IA `on` e UM job em `hm.q.flows`;
 *  - rollback forçado depois do handler, antes do COMMIT: nem a transferência nem o job;
 *  - trava de origem (F70-S08) recusa: nada muda e nenhum job é gravado.
 *
 * Skip automático sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { ConversationOriginValue } from '@hm/shared';
import { envelopeSchema } from '@hm/shared/mq';
import { makeTransferToAgentHandler } from './agent-transfer-handlers';
import { EMPTY_TOOL_CONTEXT } from './registry';

const url = process.env['DATABASE_URL'];
const FORCED = 'F70-S25: rollback forçado pelo teste';

describe.skipIf(!url)('transfer_to_agent → gatilho da IA na outbox (DB, F70-S25)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const DEPT = randomUUID();
  const FROM_AGENT = randomUUID();
  const TO_AGENT = randomUUID();
  const sfx = WS.slice(0, 8);
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  const handler = makeTransferToAgentHandler({ logger });

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'F70S25 transfer', slug: `f70s25-tr-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S25',
      phoneNumberId: `PN_F70S25_TR_${sfx}`,
      wabaId: `WABA_F70S25_TR_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55117' + sfx.replace(/\D/g, '3').padEnd(8, '3').slice(0, 8),
    });
    await db.insert(schema.agents).values([
      { id: FROM_AGENT, workspaceId: WS, name: 'Origem', systemPrompt: 'F70-S25' },
      { id: TO_AGENT, workspaceId: WS, name: 'Destino', systemPrompt: 'F70-S25' },
    ]);
    await db.insert(schema.departments).values({ id: DEPT, workspaceId: WS, name: 'Vendas' });
    await db.insert(schema.agentDepartments).values([
      { agentId: FROM_AGENT, departmentId: DEPT, workspaceId: WS },
      { agentId: TO_AGENT, departmentId: DEPT, workspaceId: WS },
    ]);
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  async function conversation(origin: ConversationOriginValue | null): Promise<string> {
    const id = randomUUID();
    await getDb()
      .insert(schema.conversations)
      .values({
        id,
        workspaceId: WS,
        channelId: CHANNEL,
        contactId: CONTACT,
        remoteId: `r-${id.slice(0, 12)}`,
        origin,
        aiMode: 'paused',
        aiPausedReason: 'human_takeover',
        aiPausedAt: new Date(),
        agentId: FROM_AGENT,
      });
    return id;
  }

  function transfer(conversationId: string, forceRollback = false) {
    return withWorkspace(WS, async (tx) => {
      const res = await handler(
        {
          workspaceId: WS,
          conversationId,
          agentId: FROM_AGENT,
          executionId: randomUUID(),
          args: { targetAgentId: TO_AGENT, reason: 'teste' },
        },
        tx,
        EMPTY_TOOL_CONTEXT,
      );
      if (forceRollback) throw new Error(FORCED);
      return res;
    });
  }

  async function jobsOf(conversationId: string) {
    const rows = await getDb()
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.workspaceId, WS), eq(schema.outbox.routingKey, 'hm.q.flows')));
    return rows
      .map((r) => ({ ...r, envelope: envelopeSchema.parse(r.envelope) }))
      .filter(
        (r) => (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
      );
  }

  async function stateOf(conversationId: string) {
    const [row] = await getDb()
      .select({ aiMode: schema.conversations.aiMode, agentId: schema.conversations.agentId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    return row;
  }

  it('commit: transfere, liga a IA e grava UM job em hm.q.flows', async () => {
    const conv = await conversation('origem:anuncio');
    const res = await transfer(conv);
    expect(res.ok).toBe(true);
    expect(await stateOf(conv)).toEqual({ aiMode: 'on', agentId: TO_AGENT });

    const jobs = await jobsOf(conv);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '' });
    expect(jobs[0]?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(jobs[0]?.envelope.payload).toEqual({
      conversationId: conv,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
    });
  });

  it('rollback: nem a transferência nem o job ficam', async () => {
    const conv = await conversation('origem:anuncio');
    await expect(transfer(conv, true)).rejects.toThrow(FORCED);
    expect(await stateOf(conv)).toEqual({ aiMode: 'paused', agentId: FROM_AGENT });
    expect(await jobsOf(conv)).toHaveLength(0);
  });

  it('trava de origem: sem-origem pausada não é transferida e nenhum job é gravado', async () => {
    const conv = await conversation('sem-origem');
    const res = await transfer(conv);
    expect(res.ok).toBe(false);
    expect(await stateOf(conv)).toEqual({ aiMode: 'paused', agentId: FROM_AGENT });
    expect(await jobsOf(conv)).toHaveLength(0);
  });
});
