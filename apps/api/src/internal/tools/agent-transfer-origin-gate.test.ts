/**
 * F70-S08 — trava de origem da IA no `transfer_to_agent`, contra o Postgres dev.
 *
 * O teste unitário (`agent-transfer-handlers.test.ts`) mocka o `tx`; aqui o UPDATE
 * condicional roda de verdade sob RLS (`withWorkspace`), com dois agentes reais no
 * mesmo departamento (a authz de alvo passa, então quem decide é a trava):
 *  - `sem-origem` + IA pausada → recusa: IA continua `paused`, agente não muda,
 *    nada enfileirado;
 *  - origem NULL (conversa legada) + IA `off` → recusa (fail-closed);
 *  - `origem:anuncio` + IA pausada → transfere e liga a IA;
 *  - `sem-origem` com IA já `on` (ligada à mão por um humano) → só troca o agente:
 *    a transferência não LIGA nada, então não é barrada.
 *
 * Skip automático sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { ConversationOriginValue } from '@hm/shared';
import { makeTransferToAgentHandler } from './agent-transfer-handlers';

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('transfer_to_agent — trava de origem (DB, F70-S08)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const DEPT = randomUUID();
  const FROM_AGENT = randomUUID();
  const TO_AGENT = randomUUID();
  const sfx = WS.slice(0, 8);

  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'F70S08 transfer', slug: `f70s08-tr-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S08',
      phoneNumberId: `PN_F70S08_TR_${sfx}`,
      wabaId: `WABA_F70S08_TR_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55118' + sfx.replace(/\D/g, '4').padEnd(8, '4').slice(0, 8),
    });
    await db.insert(schema.agents).values([
      { id: FROM_AGENT, workspaceId: WS, name: 'Origem', systemPrompt: 'F70-S08' },
      { id: TO_AGENT, workspaceId: WS, name: 'Destino', systemPrompt: 'F70-S08' },
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

  async function conversation(
    origin: ConversationOriginValue | null,
    aiMode: 'on' | 'off' | 'paused',
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
        origin,
        aiMode,
        agentId: FROM_AGENT,
        ...(aiMode === 'paused'
          ? { aiPausedReason: 'human_takeover', aiPausedAt: new Date() }
          : {}),
      });
    return id;
  }

  async function transfer(conversationId: string) {
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage, logger });
    const res = await withWorkspace(WS, (tx) =>
      handler(
        {
          workspaceId: WS,
          conversationId,
          agentId: FROM_AGENT,
          executionId: randomUUID(),
          args: { targetAgentId: TO_AGENT, reason: 'teste' },
        },
        tx,
      ),
    );
    const [row] = await getDb()
      .select({
        aiMode: schema.conversations.aiMode,
        agentId: schema.conversations.agentId,
        aiPausedReason: schema.conversations.aiPausedReason,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    return { res, row, reengage };
  }

  it('sem-origem + IA pausada → recusa, nada muda, nada enfileirado', async () => {
    const conv = await conversation('sem-origem', 'paused');
    const { res, row, reengage } = await transfer(conv);
    expect(res.ok).toBe(false);
    expect(row).toEqual({ aiMode: 'paused', agentId: FROM_AGENT, aiPausedReason: 'human_takeover' });
    expect(reengage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('trava de origem'),
      expect.objectContaining({ conversationId: conv, reason: 'origin_not_eligible' }),
    );
  });

  it('origem NULL (legado) + IA off → recusa (fail-closed)', async () => {
    const conv = await conversation(null, 'off');
    const { res, row, reengage } = await transfer(conv);
    expect(res.ok).toBe(false);
    expect(row).toMatchObject({ aiMode: 'off', agentId: FROM_AGENT });
    expect(reengage).not.toHaveBeenCalled();
  });

  it('origem:anuncio + IA pausada → transfere e liga a IA', async () => {
    const conv = await conversation('origem:anuncio', 'paused');
    const { res, row, reengage } = await transfer(conv);
    expect(res.ok).toBe(true);
    expect(row).toEqual({ aiMode: 'on', agentId: TO_AGENT, aiPausedReason: null });
    expect(reengage).toHaveBeenCalledTimes(1);
  });

  it('sem-origem com IA já on (ligada à mão) → só troca o agente', async () => {
    const conv = await conversation('sem-origem', 'on');
    const { res, row } = await transfer(conv);
    expect(res.ok).toBe(true);
    expect(row).toMatchObject({ aiMode: 'on', agentId: TO_AGENT });
  });
});
