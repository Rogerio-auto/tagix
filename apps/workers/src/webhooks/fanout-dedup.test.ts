/**
 * F70-S16 — dedup do fan-out de webhooks pelo índice único, contra o Postgres dev.
 *
 * `uq_outbound_webhook_deliveries_event` em `(webhook_id, payload #>> '{_meta,eventId}')`
 * + `INSERT … ON CONFLICT DO NOTHING` substituem a varredura com advisory lock:
 *  - N fan-outs concorrentes do MESMO evento (reentrega da fila, republicação do relay
 *    da outbox) → uma entrega por webhook;
 *  - o índice existe com a expressão certa e o banco recusa uma duplicata direta;
 *  - entregas sem `_meta.eventId` (NULL) não colidem entre si;
 *  - o mesmo eventId em webhooks diferentes são entregas diferentes.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, encryptSecret, getDb, schema } from '@hm/db';
import { fanoutEvent, type WebhookEvent } from './fanout';

const { workspaces, outboundWebhooks, outboundWebhookDeliveries } = schema;
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('F70-S16 fan-out: dedup pelo índice único', () => {
  let ws = '';
  let hookA = '';
  let hookB = '';

  const deliveriesOf = (eventId: string) =>
    getDb()
      .select({ id: outboundWebhookDeliveries.id, webhookId: outboundWebhookDeliveries.webhookId })
      .from(outboundWebhookDeliveries)
      .where(
        sql`${outboundWebhookDeliveries.workspaceId} = ${ws}::uuid
            AND ${outboundWebhookDeliveries.payload} #>> '{_meta,eventId}' = ${eventId}`,
      );

  const evento = (): WebhookEvent => ({
    workspaceId: ws,
    event: 'message.received',
    eventId: `${randomUUID()}:received`,
    occurredAt: new Date().toISOString(),
    data: { messageId: randomUUID() },
  });

  beforeAll(async () => {
    const db = getDb();
    const [w] = await db
      .insert(workspaces)
      .values({ name: 'F70S16 fanout', slug: `f70s16-fo-${randomUUID().slice(0, 8)}` })
      .returning();
    if (!w) throw new Error('workspace');
    ws = w.id;
    const hooks = await db
      .insert(outboundWebhooks)
      .values(
        ['A', 'B'].map((n) => ({
          workspaceId: ws,
          name: `hook ${n}`,
          url: `https://example.com/${n}`,
          events: ['message.received'],
          isActive: true,
          secretEnc: encryptSecret('segredo'),
        })),
      )
      .returning({ id: outboundWebhooks.id });
    hookA = hooks[0]?.id ?? '';
    hookB = hooks[1]?.id ?? '';
    if (!hookA || !hookB) throw new Error('webhooks');
  });

  afterAll(async () => {
    await getDb().delete(workspaces).where(eq(workspaces.id, ws));
    await closeDb();
  });

  it('o índice existe, é único e usa a expressão do eventId', async () => {
    const rows = Array.from(
      await getDb().execute(sql`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'outbound_webhook_deliveries'
           AND indexname = 'uq_outbound_webhook_deliveries_event'`),
    ) as Array<{ indexdef: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0]?.indexdef).toContain('webhook_id');
    expect(rows[0]?.indexdef).toMatch(/payload #>> '\{_meta,eventId\}'/);
  });

  it('8 fan-outs concorrentes do mesmo evento → uma entrega por webhook', async () => {
    const evt = evento();
    const results = await Promise.all(Array.from({ length: 8 }, () => fanoutEvent(evt)));

    expect(results.every((r) => r.matchedWebhooks === 2)).toBe(true);
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(2);
    expect(results.reduce((n, r) => n + r.deduped, 0)).toBe(14);
    const rows = await deliveriesOf(evt.eventId);
    expect(rows.map((r) => r.webhookId).sort()).toEqual([hookA, hookB].sort());
  });

  it('replay sequencial não duplica e devolve deduped', async () => {
    const evt = evento();
    expect(await fanoutEvent(evt)).toEqual({ matchedWebhooks: 2, created: 2, deduped: 0 });
    expect(await fanoutEvent(evt)).toEqual({ matchedWebhooks: 2, created: 0, deduped: 2 });
    expect(await deliveriesOf(evt.eventId)).toHaveLength(2);
  });

  it('o banco recusa duplicata direta; entregas sem eventId não colidem', async () => {
    const eventId = `${randomUUID()}:received`;
    const linha = (payload: Record<string, unknown>) => ({
      webhookId: hookA,
      workspaceId: ws,
      event: 'message.received',
      payload,
    });
    const db = getDb();
    await db.insert(outboundWebhookDeliveries).values(linha({ _meta: { eventId } }));
    let causa = '';
    try {
      await db.insert(outboundWebhookDeliveries).values(linha({ _meta: { eventId }, outra: 1 }));
    } catch (err: unknown) {
      const c = err instanceof Error && err.cause instanceof Error ? err.cause : err;
      causa = c instanceof Error ? c.message : String(c);
    }
    expect(causa).toMatch(/uq_outbound_webhook_deliveries_event/);

    // Sem `_meta.eventId`: NULL não colide com NULL.
    await db.insert(outboundWebhookDeliveries).values(linha({ semMeta: 1 }));
    await db.insert(outboundWebhookDeliveries).values(linha({ semMeta: 2 }));
    const semEventId = Array.from(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM outbound_webhook_deliveries
         WHERE webhook_id = ${hookA}::uuid AND payload #>> '{_meta,eventId}' IS NULL`),
    ) as Array<{ n: number }>;
    expect(semEventId[0]?.n).toBe(2);
  });
});
