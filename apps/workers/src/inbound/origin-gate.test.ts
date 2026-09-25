/**
 * F70-S07 — origem, atribuição, eco do IG e trava da IA, ponta a ponta no pipeline
 * inbound real (parsers de `@hm/channels` → `DbInboundPersistence` → Postgres dev
 * sob RLS) + a trava do flow `ai_action` (handler real + port real de outbound).
 *
 *  1. WhatsApp sem prova de origem → `sem-origem` (+ etiqueta); flow `ai_action
 *     ACTIVATE` → a IA continua `off`.
 *  2. Click-to-WhatsApp → `origem:anuncio`; contato com `ad_*`; ACTIVATE liga.
 *  3. Segundo anúncio do mesmo contato NÃO sobrescreve o primeiro toque.
 *  4. Texto do botão do site (marcador em `workspaces.settings`) → `origem:site`.
 *  5. Instagram: DM de anúncio → `origem:anuncio` + `ad_*` do IG; o eco do app
 *     (`is_echo`) no mesmo webhook vira mensagem `member` e pausa a IA.
 *
 * Toca o Postgres dev — pula sem `DATABASE_URL`. A parte sem DB (handoff de
 * campanha) roda sempre.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger, type Logger } from '@hm/logger';
import { parseInstagramWebhook, parseWahaWebhook, parseWhatsAppWebhook } from '@hm/channels';
import {
  createOutboundPort,
  getHandler,
  type FlowExecutionContext,
  type SetConversationAiResult,
} from '@hm/flow-engine';
import { runInboundPipeline } from './pipeline';
import { ChannelInboundParser } from './parse';
import {
  DbInboundPersistence,
  type InboundFlowEnqueuePort,
  type InboundSocketPort,
} from './db-ports';
import { createInstagramEchoStep } from './instagram-echoes';
import { gateCampaignAiHandoff } from './ai-gate';
import { createCoexistenceDeps } from '../coexistence/worker';
import type { StatusDeps } from './status';
import type { InboundDeps } from './ports';
import type { CampaignInboundPorts, InboundMessage } from '../campaigns-inbound/processor';

const url = process.env['DATABASE_URL'];

// ─── Fakes (sem IO) ───────────────────────────────────────────────────────────

const noopSocket: InboundSocketPort = {
  async emitMessageNew() {},
  async emitContactPresence() {},
  async emitConversationAssigned() {},
};
const noopFlow: InboundFlowEnqueuePort = { async enqueue() {} };
const noopStatusDeps: StatusDeps = {
  channels: {
    async resolve() {
      return null;
    },
  },
  persistence: {
    async applyStatus() {
      return { outcome: 'not_found' as const };
    },
  },
  socket: { async emitStatusChanged() {} },
  orphan: {
    async record() {},
    async drain() {
      return null;
    },
  },
};

// ─── Handoff de campanha (sem DB) ─────────────────────────────────────────────

describe('gateCampaignAiHandoff (F70-S07)', () => {
  const message: InboundMessage = {
    workspaceId: 'ws',
    channelId: 'ch',
    contactId: 'ct',
    conversationId: 'conv',
    text: 'oi',
  };
  const base: CampaignInboundPorts = {
    optOutContact: vi.fn(async () => undefined),
    sendOptOutConfirmation: vi.fn(async () => undefined),
    findRecentDelivery: vi.fn(async () => null),
    markRecipientResponded: vi.fn(async () => undefined),
    handoffToAgent: vi.fn(async () => ({ applied: true })),
    publishFollowup: vi.fn(async () => undefined),
  };

  it('liga a IA pelo port com trava (nunca pelo UPDATE cru da campanha)', async () => {
    const setConversationAi = vi.fn(
      async (): Promise<SetConversationAiResult> => ({ applied: true }),
    );
    const logger = createLogger('error');
    const gated = gateCampaignAiHandoff(base, { setConversationAi }, logger);
    await expect(gated.handoffToAgent(message, 'agent-1')).resolves.toEqual({ applied: true });
    expect(setConversationAi).toHaveBeenCalledWith('ws', {
      conversationId: 'conv',
      aiMode: 'on',
      agentId: 'agent-1',
    });
    expect(base.handoffToAgent).not.toHaveBeenCalled();
  });

  it('origem não comprovada → recusa registrada, sem lançar', async () => {
    const setConversationAi = vi.fn(
      async (): Promise<SetConversationAiResult> => ({
        applied: false,
        reason: 'origin_not_eligible',
      }),
    );
    const logger = createLogger('error');
    const warn = vi.spyOn(logger, 'warn');
    const gated = gateCampaignAiHandoff(base, { setConversationAi }, logger);
    // F70-S13: a recusa sobe (antes o contrato era `void` e o processor dizia handedOff).
    await expect(gated.handoffToAgent(message, 'agent-1')).resolves.toEqual({ applied: false });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('recusado'),
      expect.objectContaining({ reason: 'origin_not_eligible', conversationId: 'conv' }),
    );
  });
});

// ─── Pipeline real contra o Postgres dev ─────────────────────────────────────

describe.skipIf(!url)('F70-S07 origem + atribuição + eco IG + trava da IA (DB)', () => {
  const logger: Logger = createLogger('error');
  const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
  const digits = sfx.replace(/\D/g, '7').padEnd(8, '7').slice(0, 8);
  const phoneNumberId = 'PN_F70S07_' + sfx;
  const igAccount = '1784' + digits;
  const SITE_MARKER = 'Vim pelo site do Leadium';
  let workspaceId = '';

  const deps: InboundDeps = {
    parser: new ChannelInboundParser(
      {
        metaWhatsApp: parseWhatsAppWebhook,
        waha: parseWahaWebhook,
        metaInstagram: parseInstagramWebhook,
      },
      logger,
    ),
    persistence: new DbInboundPersistence(noopSocket, noopFlow, noopStatusDeps, logger),
    media: { async enqueue() {} },
    instagramEchoes: createInstagramEchoStep(createCoexistenceDeps(logger)),
  };

  const outbound = createOutboundPort();

  function waPayload(
    from: string,
    wamid: string,
    text: string,
    referral?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_' + sfx,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511900000000', phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Lead ' + from.slice(-4) }, wa_id: from }],
                messages: [
                  {
                    from,
                    id: wamid,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: text },
                    ...(referral !== undefined ? { referral } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  function ctwa(sourceId: string, clid: string): Record<string, unknown> {
    return {
      source_url: 'https://fb.me/' + sourceId,
      source_id: sourceId,
      source_type: 'ad',
      headline: 'Anúncio ' + sourceId,
      media_type: 'image',
      ctwa_clid: clid,
    };
  }

  async function conversationFor(remoteId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          eq(schema.conversations.remoteId, remoteId),
        ),
      )
      .limit(1);
    if (row === undefined) throw new Error('conversa não encontrada: ' + remoteId);
    return row;
  }

  async function contactFor(remoteId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.phone, remoteId)))
      .limit(1);
    if (row === undefined) throw new Error('contato não encontrado: ' + remoteId);
    return row;
  }

  async function tagsOf(contactId: string): Promise<string[]> {
    const rows = await getDb()
      .select({ name: schema.tags.name })
      .from(schema.contactTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.contactTags.tagId))
      .where(eq(schema.contactTags.contactId, contactId));
    return rows.map((r) => r.name).sort();
  }

  /** Roda o handler real `ai_action` com o port real (trava no UPDATE). */
  async function flowActivate(conversationId: string) {
    const handler = getHandler('ai_action');
    if (handler === undefined) throw new Error('handler ai_action ausente');
    const log = vi.fn();
    const ctx: FlowExecutionContext = {
      workspaceId,
      executionId: randomUUID(),
      flowId: randomUUID(),
      conversationId,
      contactId: null,
      variables: {},
      async sendMessage() {},
      async sendPresence() {},
      setConversationAi: (input) =>
        outbound.setConversationAi(workspaceId, { conversationId, ...input }),
      async setConversationStatus() {},
      async httpRequest() {
        return { status: 200, ok: true, body: null, headers: {} };
      },
      log,
      now: () => new Date(),
      sleep: async () => {},
    };
    // `agentId` precisa existir (FK): a conversa de anúncio aponta um agente real.
    const result = await handler.execute(
      { id: 'n1', type: 'ai_action', data: { action: 'ACTIVATE', agentId } },
      ctx,
    );
    return { result, log };
  }

  let agentId = '';

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({
        name: 'F70S07',
        slug: 'f70s07-' + sfx,
        settings: { originPrefillMarkers: { site: [SITE_MARKER] } },
      })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;

    await db.insert(schema.channels).values([
      {
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA F70S07',
        phoneNumberId,
        wabaId: 'WABA_' + sfx,
        isActive: true,
      },
      {
        workspaceId,
        provider: 'meta_instagram',
        name: 'IG F70S07',
        igUserId: igAccount,
        fbPageId: 'PAGE_' + sfx,
        isActive: true,
      },
    ]);

    const [agent] = await db
      .insert(schema.agents)
      .values({ workspaceId, name: 'Agente F70S07', systemPrompt: 'Teste F70-S07.' })
      .returning({ id: schema.agents.id });
    if (!agent) throw new Error('agente não criado');
    agentId = agent.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      const convs = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      const ids = convs.map((c) => c.id);
      if (ids.length > 0) {
        await db.delete(schema.messages).where(inArray(schema.messages.conversationId, ids));
      }
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      await db.delete(schema.contacts).where(eq(schema.contacts.workspaceId, workspaceId));
      await db.delete(schema.tags).where(eq(schema.tags.workspaceId, workspaceId));
      await db.delete(schema.agents).where(eq(schema.agents.workspaceId, workspaceId));
      await db.delete(schema.channels).where(eq(schema.channels.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await closeDb();
  });

  it('sem origem comprovada → sem-origem; flow ai_action ACTIVATE não liga a IA', async () => {
    const from = '5511' + digits.slice(0, 7) + '1';
    await runInboundPipeline(
      'meta_whatsapp',
      waPayload(from, 'wamid.plain.' + sfx, 'oi, tudo bem?'),
      deps,
      logger,
    );

    const conv = await conversationFor(from);
    expect(conv.origin).toBe('sem-origem');
    expect(conv.aiMode).toBe('off');
    expect(await tagsOf((await contactFor(from)).id)).toEqual(['sem-origem']);

    const { result, log } = await flowActivate(conv.id);
    expect(result).toEqual({
      status: 'SUCCESS',
      variables: { ai_activation_blocked: 'origin_not_eligible' },
    });
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('recusado'),
      expect.anything(),
    );
    expect((await conversationFor(from)).aiMode).toBe('off');
  });

  it('conversa legada (origin NULL) é tratada como sem-origem: IA continua off', async () => {
    const from = '5511' + digits.slice(0, 7) + '9';
    await runInboundPipeline(
      'meta_whatsapp',
      waPayload(from, 'wamid.legacy.' + sfx, 'oi'),
      deps,
      logger,
    );
    const conv = await conversationFor(from);
    await getDb()
      .update(schema.conversations)
      .set({ origin: null })
      .where(eq(schema.conversations.id, conv.id));

    await flowActivate(conv.id);
    expect((await conversationFor(from)).aiMode).toBe('off');
  });

  it('click-to-WhatsApp → origem:anuncio + ad_* no contato; ACTIVATE liga a IA', async () => {
    const from = '5511' + digits.slice(0, 7) + '2';
    await runInboundPipeline(
      'meta_whatsapp',
      waPayload(
        from,
        'wamid.ad1.' + sfx,
        'Quero saber mais',
        ctwa('120210000000000111', 'CLID_FIRST'),
      ),
      deps,
      logger,
    );

    const conv = await conversationFor(from);
    expect(conv.origin).toBe('origem:anuncio');
    const contact = await contactFor(from);
    expect(contact).toMatchObject({
      adChannel: 'meta_whatsapp',
      adSourceType: 'ad',
      adSourceId: '120210000000000111',
      adCtwaClid: 'CLID_FIRST',
      adHeadline: 'Anúncio 120210000000000111',
    });
    expect(contact.adReferredAt).toBeInstanceOf(Date);
    expect(await tagsOf(contact.id)).toEqual(['origem:anuncio']);

    const { result } = await flowActivate(conv.id);
    expect(result).toEqual({ status: 'SUCCESS' });
    const after = await conversationFor(from);
    expect(after.aiMode).toBe('on');
    expect(after.agentId).toBe(agentId);
  });

  it('segundo anúncio do mesmo contato não sobrescreve o primeiro toque', async () => {
    const from = '5511' + digits.slice(0, 7) + '2';
    const before = await contactFor(from);
    await runInboundPipeline(
      'meta_whatsapp',
      waPayload(
        from,
        'wamid.ad2.' + sfx,
        'Vi outro anúncio',
        ctwa('120210000000000222', 'CLID_SECOND'),
      ),
      deps,
      logger,
    );
    const after = await contactFor(from);
    expect(after.adSourceId).toBe('120210000000000111');
    expect(after.adCtwaClid).toBe('CLID_FIRST');
    expect(after.adReferredAt?.getTime()).toBe(before.adReferredAt?.getTime());

    // A mensagem do segundo anúncio guarda o próprio referral (para o deal/relatório).
    const [msg] = await getDb()
      .select({ metadata: schema.messages.metadata })
      .from(schema.messages)
      .where(eq(schema.messages.externalId, 'wamid.ad2.' + sfx))
      .limit(1);
    expect(msg?.metadata['adReferral']).toMatchObject({ sourceId: '120210000000000222' });
  });

  it('texto do botão do site (marcador do workspace) → origem:site', async () => {
    const from = '5511' + digits.slice(0, 7) + '3';
    await runInboundPipeline(
      'meta_whatsapp',
      waPayload(from, 'wamid.site.' + sfx, 'Olá! vim pelo site do leadium, quero um orçamento'),
      deps,
      logger,
    );
    const conv = await conversationFor(from);
    expect(conv.origin).toBe('origem:site');
    expect(await tagsOf((await contactFor(from)).id)).toEqual(['origem:site']);
  });

  it('Instagram: DM de anúncio → origem:anuncio + ad_* do IG; eco do app vira member e pausa a IA', async () => {
    const igsid = '70' + digits + '01';
    const now = Date.now();
    await runInboundPipeline(
      'meta_instagram',
      {
        object: 'instagram',
        entry: [
          {
            id: igAccount,
            time: now,
            messaging: [
              {
                sender: { id: igsid },
                recipient: { id: igAccount },
                timestamp: now,
                message: {
                  mid: 'ig.mid.in.' + sfx,
                  text: 'Quero saber o valor',
                  referral: {
                    ref: 'campanha_setembro',
                    ad_id: '120210000000000456',
                    source: 'ADS',
                    type: 'OPEN_THREAD',
                    ads_context_data: { ad_title: 'Anúncio IG' },
                  },
                },
              },
            ],
          },
        ],
      },
      deps,
      logger,
    );

    const conv = await conversationFor(igsid);
    expect(conv.origin).toBe('origem:anuncio');
    const contact = await contactFor(igsid);
    expect(contact).toMatchObject({
      adChannel: 'meta_instagram',
      adSourceType: 'ad',
      adSourceId: '120210000000000456',
      adHeadline: 'Anúncio IG',
    });

    // IA ligada pelo flow (origem comprovada)…
    await flowActivate(conv.id);
    expect((await conversationFor(igsid)).aiMode).toBe('on');

    // …e o dono responde pelo app do Instagram: o eco chega no webhook.
    await runInboundPipeline(
      'meta_instagram',
      {
        object: 'instagram',
        entry: [
          {
            id: igAccount,
            time: now + 1000,
            messaging: [
              {
                sender: { id: igAccount },
                recipient: { id: igsid },
                timestamp: now + 1000,
                message: { mid: 'ig.mid.echo.' + sfx, text: 'Deixa comigo!', is_echo: true },
              },
            ],
          },
        ],
      },
      deps,
      logger,
    );

    const [echo] = await getDb()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.externalId, 'ig.mid.echo.' + sfx))
      .limit(1);
    expect(echo).toMatchObject({
      conversationId: conv.id,
      direction: 'outbound',
      senderType: 'member',
      content: 'Deixa comigo!',
    });
    expect(echo?.metadata).toMatchObject({ origin: 'app', echoSource: 'instagram_echo' });

    const paused = await conversationFor(igsid);
    expect(paused.aiMode).toBe('paused');
    expect(paused.aiPausedReason).toBe('human_takeover');
    expect(paused.firstResponseAt).toBeInstanceOf(Date);
  });
});
