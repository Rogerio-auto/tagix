/**
 * F70-S08 — `handoffToAgent` dos ports de campanha não tem mais UPDATE cru: liga a
 * IA pelo port de outbound da flow-engine (trava de origem atômica).
 *
 *  - sem DB: o port injetado é o único caminho; recusa vira `warn`, sem erro;
 *  - Postgres dev (port DEFAULT, sem `gateCampaignAiHandoff` por cima — o cenário
 *    "alguém montou os ports crus"): `sem-origem` e NULL continuam `off`;
 *    `origem:anuncio` liga com o agente da campanha.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { SetConversationAiResult } from '@hm/flow-engine';
import type { ConversationOriginValue } from '@hm/shared';
import { createCampaignInboundPorts, type CampaignInboundDbDeps } from './db-ports';
import type { InboundMessage } from './processor';

const url = process.env['DATABASE_URL'];

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
}

function message(workspaceId: string, conversationId: string): InboundMessage {
  return {
    workspaceId,
    channelId: randomUUID(),
    contactId: randomUUID(),
    conversationId,
    text: 'quero saber mais',
  };
}

describe('campaigns-inbound handoffToAgent (F70-S08, sem DB)', () => {
  it('delega ao port travado e loga a recusa sem lançar', async () => {
    const setConversationAi = vi.fn(
      async (): Promise<SetConversationAiResult> => ({ applied: false, reason: 'origin_not_eligible' }),
    );
    const logger = makeLogger();
    const ports = createCampaignInboundPorts({
      logger: logger as unknown as CampaignInboundDbDeps['logger'],
      ai: { setConversationAi },
    });

    // F70-S13: a recusa é o resultado (o processor devolve `handedOff: false`).
    await expect(ports.handoffToAgent(message('ws', 'conv'), 'agent')).resolves.toEqual({
      applied: false,
    });

    expect(setConversationAi).toHaveBeenCalledWith('ws', {
      conversationId: 'conv',
      aiMode: 'on',
      agentId: 'agent',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('trava de origem'),
      expect.objectContaining({ conversationId: 'conv', reason: 'origin_not_eligible' }),
    );
  });

  it('aplicado → sem warn', async () => {
    const logger = makeLogger();
    const ports = createCampaignInboundPorts({
      logger: logger as unknown as CampaignInboundDbDeps['logger'],
      ai: { setConversationAi: async () => ({ applied: true }) },
    });
    await expect(ports.handoffToAgent(message('ws', 'conv'), 'agent')).resolves.toEqual({
      applied: true,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe.skipIf(!url)('campaigns-inbound handoffToAgent — port default contra o Postgres dev', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const AGENT = randomUUID();
  const sfx = WS.slice(0, 8);
  const logger = makeLogger();
  const ports = createCampaignInboundPorts({
    logger: logger as unknown as CampaignInboundDbDeps['logger'],
  });

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'F70S08 camp', slug: `f70s08-ca-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S08',
      phoneNumberId: `PN_F70S08_CA_${sfx}`,
      wabaId: `WABA_F70S08_CA_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55116' + sfx.replace(/\D/g, '6').padEnd(8, '6').slice(0, 8),
    });
    await db.insert(schema.agents).values({ id: AGENT, workspaceId: WS, name: 'Campanha', systemPrompt: 'F70-S08' });
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  async function handoff(origin: ConversationOriginValue | null) {
    const id = randomUUID();
    await getDb().insert(schema.conversations).values({
      id,
      workspaceId: WS,
      channelId: CHANNEL,
      contactId: CONTACT,
      remoteId: `r-${id.slice(0, 12)}`,
      origin,
    });
    const { applied } = await ports.handoffToAgent(message(WS, id), AGENT);
    const [row] = await getDb()
      .select({ aiMode: schema.conversations.aiMode, agentId: schema.conversations.agentId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    // F70-S13: o resultado devolvido bate com o que ficou gravado.
    return { ...row, applied };
  }

  it('sem-origem → IA continua off', async () => {
    expect(await handoff('sem-origem')).toEqual({ aiMode: 'off', agentId: null, applied: false });
  });

  it('origem NULL (legado) → IA continua off', async () => {
    expect(await handoff(null)).toEqual({ aiMode: 'off', agentId: null, applied: false });
  });

  it('origem:anuncio → IA on com o agente da campanha', async () => {
    expect(await handoff('origem:anuncio')).toEqual({ aiMode: 'on', agentId: AGENT, applied: true });
  });
});
