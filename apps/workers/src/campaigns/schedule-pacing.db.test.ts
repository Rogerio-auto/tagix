/**
 * F58-S11 — agendamento, prazo, canal e ritmo contra o Postgres dev (RLS real).
 *
 * Protege o que so o banco garante:
 *  - promocao `scheduled -> running` e atomica: duas instancias simultaneas
 *    promovem (e auditam) a campanha UMA vez;
 *  - teto diario e compasso valem sob concorrencia: N dispatches simultaneos
 *    nunca passam do teto/balde (reserva sob FOR NO KEY UPDATE na transacao do envio);
 *    a recusa desfaz tudo (claim, delivery, mensagem, outbox);
 *  - prazo final fecha com motivo observavel e deixa quem sobrou como
 *    `failed campaign_end_reached`;
 *  - pausa so de `running`, com motivo + orientacao em audit_logs;
 *  - scheduleNextTick respeita cursor (greatest) e prazo (least);
 *  - canal desativado/sem credencial/credencial recusada => `blocked`.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, encryptSecret, getDb, schema } from '@hm/db';
import { MetaError, type GraphClient } from '@hm/channels';
import type { Logger } from '@hm/logger';
import { createCampaignTickPorts, type CampaignDbDeps } from './db-ports';
import type { DispatchOutcome, RunningCampaign } from './tick';

const url = process.env['DATABASE_URL'];

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

describe.skipIf(!url)('F58-S11 agendamento e ritmo (Postgres)', () => {
  const sfx = randomUUID().slice(0, 8);
  const channel = {
    sendToQueue: vi.fn(() => true),
    publish: vi.fn(() => true),
  } as unknown as CampaignDbDeps['channel'];
  const ports = createCampaignTickPorts({ channel, logger: makeLogger() });

  let workspaceId = '';
  let channelId = '';
  let seq = 0;

  async function novaCampanha(
    over: Partial<typeof schema.campaigns.$inferInsert> = {},
  ): Promise<{ id: string; stepId: string }> {
    const [camp] = await getDb()
      .insert(schema.campaigns)
      .values({
        workspaceId,
        channelId,
        name: `F58S11 ${(seq += 1)}`,
        type: 'broadcast',
        status: 'running',
        ...over,
      })
      .returning({ id: schema.campaigns.id });
    if (!camp) throw new Error('campanha nao criada');
    const [step] = await getDb()
      .insert(schema.campaignSteps)
      .values({ campaignId: camp.id, position: 0, templateName: 'promo' })
      .returning({ id: schema.campaignSteps.id });
    if (!step) throw new Error('step nao criado');
    return { id: camp.id, stepId: step.id };
  }

  async function destinatarios(campaignId: string, n: number) {
    const out: Array<{ recipientId: string; contactId: string }> = [];
    for (let i = 0; i < n; i++) {
      const [c] = await getDb()
        .insert(schema.contacts)
        .values({
          workspaceId,
          phone: `5511${String((seq += 1) * 1000 + i).padStart(9, '7')}${sfx.slice(0, 2).replace(/\D/g, '1')}`,
        })
        .returning({ id: schema.contacts.id });
      if (!c) throw new Error('contato nao criado');
      const [r] = await getDb()
        .insert(schema.campaignRecipients)
        .values({ workspaceId, campaignId, contactId: c.id })
        .returning({ id: schema.campaignRecipients.id });
      if (!r) throw new Error('recipient nao criado');
      out.push({ recipientId: r.id, contactId: c.id });
    }
    return out;
  }

  const snapshot = (id: string, over: Partial<RunningCampaign> = {}): RunningCampaign => ({
    id,
    workspaceId,
    channelId,
    sendWindows: null,
    rateLimitPerMinute: 60,
    deliveryRate: null,
    endAt: null,
    nextTickAt: null,
    ...over,
  });

  const campanha = async (id: string) => {
    const [row] = await getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
    return row;
  };

  const auditoria = (id: string) =>
    getDb()
      .select({ action: schema.auditLogs.action, metadata: schema.auditLogs.metadata })
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.resourceType, 'campaign'), eq(schema.auditLogs.resourceId, id)),
      );

  beforeAll(async () => {
    const [ws] = await getDb()
      .insert(schema.workspaces)
      .values({ name: 'F58S11', slug: `f58s11-${sfx}`, planId: null })
      .returning();
    if (!ws) throw new Error('workspace nao criado');
    workspaceId = ws.id;
    const [canal] = await getDb()
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA',
        phoneNumberId: `PN_F58S11_${sfx}`,
        wabaId: `WABA_F58S11_${sfx}`,
      })
      .returning();
    if (!canal) throw new Error('canal nao criado');
    channelId = canal.id;
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await closeDb();
  });

  it('promove scheduled -> running UMA vez com duas instancias simultaneas', async () => {
    const now = new Date();
    const vencida = await novaCampanha({
      status: 'scheduled',
      startAt: new Date(now.getTime() - 1000),
    });
    const futura = await novaCampanha({
      status: 'scheduled',
      startAt: new Date(now.getTime() + 3_600_000),
    });

    const [a, b] = await Promise.all([
      ports.promoteScheduledCampaigns(now),
      ports.promoteScheduledCampaigns(now),
    ]);
    const nossas = [...a, ...b].filter((p) => p.id === vencida.id || p.id === futura.id);
    expect(nossas.map((p) => p.id)).toEqual([vencida.id]);

    const row = await campanha(vencida.id);
    expect(row?.status).toBe('running');
    expect(row?.nextTickAt?.getTime()).toBe(now.getTime());
    expect((await campanha(futura.id))?.status).toBe('scheduled');

    const audit = await auditoria(vencida.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'campaign.started',
      metadata: { reason: 'start_at_reached' },
    });

    // A promovida aparece na listagem do MESMO tick.
    const due = await ports.listDueCampaigns(now);
    expect(due.find((d) => d.id === vencida.id)).toMatchObject({ endAt: null, nextTickAt: now });
  });

  it('teto diario sob concorrencia: 8 dispatches simultaneos, teto 3 => exatamente 3', async () => {
    const camp = await novaCampanha({ dailyLimit: 3, nextTickAt: null });
    const recs = await destinatarios(camp.id, 8);
    const now = new Date();

    const outcomes = await Promise.all(
      recs.map((r) =>
        ports.enqueueDelivery(
          snapshot(camp.id),
          { ...r, stepId: camp.stepId, stepIndex: 0 },
          `f58s11:${r.recipientId}`,
          now,
          { ratePerMinute: 600, windowMs: 60_000 },
        ),
      ),
    );
    const enq = outcomes.filter((o) => o.kind === 'enqueued');
    const closed = outcomes.filter(
      (o): o is Extract<DispatchOutcome, { kind: 'gate_closed' }> => o.kind === 'gate_closed',
    );
    expect(enq).toHaveLength(3);
    expect(closed).toHaveLength(5);
    expect(closed.every((o) => o.reason === 'daily_quota')).toBe(true);

    expect((await campanha(camp.id))?.messagesSentToday).toBe(3);
    const deliveries = await getDb()
      .select({ id: schema.campaignDeliveries.id })
      .from(schema.campaignDeliveries)
      .where(eq(schema.campaignDeliveries.campaignId, camp.id));
    expect(deliveries).toHaveLength(3);
    // Recusa = rollback: quem ficou de fora continua pending, sem tentativa gasta.
    const restantes = await getDb()
      .select({
        status: schema.campaignRecipients.status,
        attempts: schema.campaignRecipients.attempts,
      })
      .from(schema.campaignRecipients)
      .where(
        and(
          eq(schema.campaignRecipients.campaignId, camp.id),
          eq(schema.campaignRecipients.status, 'pending'),
          eq(schema.campaignRecipients.lastStepIndex, -1),
        ),
      );
    expect(restantes).toHaveLength(5);
    expect(restantes.every((r) => r.attempts === 0)).toBe(true);
  });

  it('compasso sob concorrencia: 60/min com janela 5s => no maximo 6 no mesmo instante', async () => {
    const camp = await novaCampanha({ dailyLimit: null, nextTickAt: null });
    const recs = await destinatarios(camp.id, 10);
    const now = new Date();
    const outcomes = await Promise.all(
      recs.map((r) =>
        ports.enqueueDelivery(
          snapshot(camp.id),
          { ...r, stepId: camp.stepId, stepIndex: 0 },
          `f58s11p:${r.recipientId}`,
          now,
          { ratePerMinute: 60, windowMs: 5000 },
        ),
      ),
    );
    expect(outcomes.filter((o) => o.kind === 'enqueued')).toHaveLength(6);
    expect(outcomes.filter((o) => o.kind === 'gate_closed' && o.reason === 'pace')).toHaveLength(4);
    // Cursor = (now - 5s) + 6 * 1s: a proxima sai 1s depois de agora.
    expect((await campanha(camp.id))?.nextTickAt?.getTime()).toBe(now.getTime() + 1000);
  });

  it('pausada no meio do lote: o dispatch seguinte recusa (not_running) e nada sai', async () => {
    const camp = await novaCampanha({ nextTickAt: null });
    const [r] = await destinatarios(camp.id, 1);
    await getDb()
      .update(schema.campaigns)
      .set({ status: 'paused' })
      .where(eq(schema.campaigns.id, camp.id));
    const out = await ports.enqueueDelivery(
      snapshot(camp.id),
      { ...r!, stepId: camp.stepId, stepIndex: 0 },
      `f58s11np:${r!.recipientId}`,
      new Date(),
      { ratePerMinute: 60, windowMs: 5000 },
    );
    expect(out).toEqual({ kind: 'gate_closed', reason: 'not_running', retryAt: null });
  });

  it('prazo final: fecha com motivo, quem sobrou fica de fora; segunda chamada nao refaz', async () => {
    const endAt = new Date(Date.now() - 1000);
    const camp = await novaCampanha({ endAt });
    await destinatarios(camp.id, 3);
    const now = new Date();

    const first = await ports.closeCampaign(snapshot(camp.id, { endAt }), 'end_at_reached', now);
    expect(first).toEqual({ closed: true, notReached: 3 });
    const row = await campanha(camp.id);
    expect(row?.status).toBe('completed');
    expect(row?.nextTickAt).toBeNull();

    const recs = await getDb()
      .select({
        status: schema.campaignRecipients.status,
        reason: schema.campaignRecipients.failedReason,
      })
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.campaignId, camp.id));
    expect(recs.every((r) => r.status === 'failed' && r.reason === 'campaign_end_reached')).toBe(
      true,
    );

    const audit = await auditoria(camp.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'campaign.completed',
      metadata: { reason: 'end_at_reached', notReached: 3 },
    });
    expect(String(audit[0]?.metadata['message'])).toContain('prazo final');

    expect(await ports.closeCampaign(snapshot(camp.id, { endAt }), 'end_at_reached', now)).toEqual({
      closed: false,
      notReached: 0,
    });
  });

  it('prazo final numa campanha ja pausada: nao fecha nem mexe nos recipients', async () => {
    const endAt = new Date(Date.now() - 1000);
    const camp = await novaCampanha({ endAt, status: 'paused' });
    await destinatarios(camp.id, 2);
    expect(
      await ports.closeCampaign(snapshot(camp.id, { endAt }), 'end_at_reached', new Date()),
    ).toEqual({
      closed: false,
      notReached: 0,
    });
    const pend = await getDb()
      .select({ id: schema.campaignRecipients.id })
      .from(schema.campaignRecipients)
      .where(
        and(
          eq(schema.campaignRecipients.campaignId, camp.id),
          eq(schema.campaignRecipients.status, 'pending'),
        ),
      );
    expect(pend).toHaveLength(2);
  });

  it('pausa so de running e grava motivo + orientacao', async () => {
    const running = await novaCampanha();
    const done = await novaCampanha({ status: 'completed' });
    await ports.pauseCampaign(running.id, 'channel_credentials_invalid');
    await ports.pauseCampaign(done.id, 'quality_red');

    expect((await campanha(running.id))?.status).toBe('paused');
    expect((await campanha(done.id))?.status).toBe('completed');
    const audit = await auditoria(running.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'campaign.paused',
      metadata: { reason: 'channel_credentials_invalid' },
    });
    expect(String(audit[0]?.metadata['message'])).toContain('Reconecte');
    expect(await auditoria(done.id)).toHaveLength(0);
  });

  it('scheduleNextTick: nunca antes do cursor, nunca depois do prazo', async () => {
    const base = Date.now();
    const cursor = new Date(base + 10_000);
    const endAt = new Date(base + 60_000);
    const camp = await novaCampanha({ nextTickAt: cursor, endAt });

    await ports.scheduleNextTick(camp.id, new Date(base));
    expect((await campanha(camp.id))?.nextTickAt?.getTime()).toBe(cursor.getTime());

    await ports.scheduleNextTick(camp.id, new Date(base + 30_000));
    expect((await campanha(camp.id))?.nextTickAt?.getTime()).toBe(base + 30_000);

    await ports.scheduleNextTick(camp.id, new Date(base + 86_400_000));
    expect((await campanha(camp.id))?.nextTickAt?.getTime()).toBe(endAt.getTime());
  });

  describe('inspectChannel', () => {
    async function canal(over: Partial<typeof schema.channels.$inferInsert> = {}) {
      const [c] = await getDb()
        .insert(schema.channels)
        .values({
          workspaceId,
          provider: 'meta_whatsapp',
          name: 'WA2',
          phoneNumberId: `PN_${randomUUID()}`,
          wabaId: `WABA_${randomUUID()}`,
          ...over,
        })
        .returning({ id: schema.channels.id });
      if (!c) throw new Error('canal nao criado');
      return c.id;
    }

    it('canal desativado => blocked channel_inactive', async () => {
      const id = await canal({ isActive: false });
      expect(await ports.inspectChannel(snapshot(randomUUID(), { channelId: id }))).toEqual({
        kind: 'blocked',
        reason: 'channel_inactive',
      });
    });

    it('sem segredo => blocked channel_credentials_missing', async () => {
      const id = await canal();
      expect(await ports.inspectChannel(snapshot(randomUUID(), { channelId: id }))).toEqual({
        kind: 'blocked',
        reason: 'channel_credentials_missing',
      });
    });

    it('segredo ilegivel => blocked channel_credentials_invalid', async () => {
      const id = await canal();
      await getDb().insert(schema.channelSecrets).values({ channelId: id, accessTokenEnc: 'lixo' });
      expect(await ports.inspectChannel(snapshot(randomUUID(), { channelId: id }))).toEqual({
        kind: 'blocked',
        reason: 'channel_credentials_invalid',
      });
    });

    it.skipIf(!process.env['ENCRYPTION_KEY'])(
      'Meta recusa o token (190) => credentials_invalid; Meta fora => unavailable; ok => cache',
      async () => {
        const id = await canal();
        await getDb()
          .insert(schema.channelSecrets)
          .values({ channelId: id, accessTokenEnc: encryptSecret('tok') });
        const get = vi.fn();
        const graph = { get } as unknown as GraphClient;
        const p = createCampaignTickPorts({ channel, logger: makeLogger(), graph });
        const camp = snapshot(randomUUID(), { channelId: id });

        get.mockRejectedValueOnce(new MetaError('Invalid OAuth', { httpStatus: 400, code: 190 }));
        expect(await p.inspectChannel(camp)).toEqual({
          kind: 'blocked',
          reason: 'channel_credentials_invalid',
        });

        get.mockRejectedValueOnce(new MetaError('down', { httpStatus: 503, retryable: true }));
        expect(await p.inspectChannel(camp)).toMatchObject({ kind: 'unavailable' });

        get.mockResolvedValueOnce({ quality_rating: 'YELLOW', messaging_limit_tier: 'TIER_1K' });
        expect(await p.inspectChannel(camp)).toMatchObject({
          kind: 'ready',
          health: { qualityRating: 'YELLOW' },
        });
        // Segunda leitura vem do cache (sem chamar a Graph de novo).
        await p.inspectChannel(camp);
        expect(get).toHaveBeenCalledTimes(3);
      },
    );
  });

  it('limpeza: so campanhas deste workspace foram criadas', async () => {
    const rows = await getDb()
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.workspaceId, [workspaceId]));
    expect(rows.length).toBeGreaterThan(0);
  });
});
